import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { CoreSystem } from "@nexus-core/core";

interface QueryRunnerProps {
  system: CoreSystem;
}

const EXAMPLE_QUERIES = [
  "SELECT * FROM core.nodes LIMIT 10;",
  "SELECT * FROM pgmq.meta;",
  "SELECT COUNT(*) FROM core.event_log;",
  "SELECT * FROM core.scheduled_tasks;",
  "SELECT namespace, COUNT(*) FROM core.event_log GROUP BY namespace;",
  "SELECT proname, pg_get_function_arguments(oid) FROM pg_proc WHERE pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'pgmq') AND proname LIKE '%create%' ORDER BY proname;",
  "SELECT extname, extversion FROM pg_extension WHERE extname = 'pgmq';"
];

export function QueryRunner({ system }: QueryRunnerProps) {
  const [selectedQueryIndex, setSelectedQueryIndex] = useState(0);
  const [query, setQuery] = useState(EXAMPLE_QUERIES[0] ?? "");
  const [results, setResults] = useState<Record<string, unknown>[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const executeQuery = async (sqlQuery: string) => {
    if (!sqlQuery.trim()) {
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const db = system.getDatabase();
      const result = await db.query(sqlQuery.trim());

      setResults(result.rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setResults(null);
    } finally {
      setLoading(false);
    }
  };

  useInput((input, key) => {
    if (key.escape) {
      setQuery("");
      setResults(null);
      setError(null);
      setSelectedQueryIndex(0);
    } else if (key.upArrow) {
      const newIndex = selectedQueryIndex > 0 ? selectedQueryIndex - 1 : EXAMPLE_QUERIES.length - 1;
      setSelectedQueryIndex(newIndex);
      setQuery(EXAMPLE_QUERIES[newIndex] ?? "");
    } else if (key.downArrow) {
      const newIndex = selectedQueryIndex < EXAMPLE_QUERIES.length - 1 ? selectedQueryIndex + 1 : 0;
      setSelectedQueryIndex(newIndex);
      setQuery(EXAMPLE_QUERIES[newIndex] ?? "");
    } else if (key.return) {
      executeQuery(query);
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text color="cyan" bold>
          SQL Query Runner
        </Text>
      </Box>
      <Box marginBottom={1} flexDirection="column">
        <Text color="gray">Select a query (use arrow keys, Enter to execute):</Text>
        <Box flexDirection="column" marginTop={1}>
          {EXAMPLE_QUERIES.map((exampleQuery, idx) => (
            <Box key={idx} marginY={0}>
              <Text color={idx === selectedQueryIndex ? "green" : "white"}>
                {idx === selectedQueryIndex ? "> " : "  "}
                {exampleQuery}
              </Text>
            </Box>
          ))}
        </Box>
        <Box borderStyle="single" padding={1} marginTop={1}>
          <Text color="cyan">Current query:</Text>
          <Text>{query || " "}</Text>
          {loading && <Text color="yellow"> (executing...)</Text>}
        </Box>
      </Box>
      {error && (
        <Box marginBottom={1}>
          <Text color="red">Error: {error}</Text>
        </Box>
      )}
      {results && (
        <Box flexDirection="column" marginTop={1}>
          <Text color="green" bold>
            Results ({results.length} rows):
          </Text>
          <Box flexDirection="column" marginTop={1}>
            {results.slice(0, 50).map((row, idx) => (
              <Box key={idx} marginY={0} flexDirection="column">
                <Text>
                  {JSON.stringify(row, null, 2)
                    .split("\n")
                    .slice(0, 10)
                    .join("\n")}
                  {JSON.stringify(row).length > 500 ? "..." : ""}
                </Text>
              </Box>
            ))}
            {results.length > 50 && (
              <Text color="gray">... and {results.length - 50} more rows</Text>
            )}
          </Box>
        </Box>
      )}
      <Box marginTop={2}>
        <Text color="gray">
          Use Up/Down arrows to select query, Enter to execute, ESC to go back
        </Text>
      </Box>
    </Box>
  );
}

