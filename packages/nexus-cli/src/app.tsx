import React, { useState, useEffect } from "react";
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

  useEffect(() => {
    let mounted = true;
    CoreSystem.connect({ connectionString, namespace })
      .then((sys) => {
        if (mounted) {
          setSystem(sys);
        }
      })
      .catch((err) => {
        if (mounted) {
          setError(err instanceof Error ? err.message : String(err));
        }
      });

    return () => {
      mounted = false;
    };
  }, [connectionString, namespace]);

  useInput((input, key) => {
    if (key.escape && view !== "main") {
      setView("main");
    }
  });

  if (error) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="red">Error connecting to database: {error}</Text>
        <Text>Press Ctrl+C to exit</Text>
      </Box>
    );
  }

  if (!system) {
    return (
      <Box padding={1}>
        <Text color="cyan">Connecting to database...</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" height="100%">
      {view === "main" && <MainMenu onSelect={setView} />}
      {view === "database" && <DatabaseViewer system={system} />}
      {view === "query" && <QueryRunner system={system} />}
      {view === "metrics" && <MetricsViewer system={system} />}
    </Box>
  );
}

