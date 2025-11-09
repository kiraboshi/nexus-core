import React, { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import type { CoreSystem } from "@nexus-core/core";

interface MetricsViewerProps {
  system: CoreSystem;
}

export function MetricsViewer({ system }: MetricsViewerProps) {
  const [metrics, setMetrics] = useState<{
    queueDepth: number;
    deadLetterQueueDepth: number;
  } | null>(null);
  const [nodeInfo, setNodeInfo] = useState<
    Array<{
      node_id: string;
      display_name: string | null;
      namespace: string;
      last_heartbeat: string;
    }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  useEffect(() => {
    loadMetrics();
    const interval = setInterval(() => {
      if (autoRefresh) {
        loadMetrics();
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [autoRefresh]);

  const loadMetrics = async () => {
    try {
      setLoading(true);
      const [metricsData, nodesResult] = await Promise.all([
        system.metrics(),
        system.getDatabase().query<{
          node_id: string;
          display_name: string | null;
          namespace: string;
          last_heartbeat: string;
        }>(`
          SELECT node_id, display_name, namespace, last_heartbeat
          FROM core.nodes
          ORDER BY last_heartbeat DESC
        `)
      ]);

      setMetrics(metricsData);
      setNodeInfo(nodesResult.rows);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useInput((input, key) => {
    if (input === "r" || input === "R") {
      loadMetrics();
    } else if (input === "a" || input === "A") {
      setAutoRefresh((prev) => !prev);
    }
  });

  if (loading && !metrics) {
    return (
      <Box padding={1}>
        <Text color="cyan">Loading metrics...</Text>
      </Box>
    );
  }

  if (error) {
    return (
      <Box padding={1}>
        <Text color="red">Error: {error}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text color="cyan" bold>
          System Metrics
        </Text>
      </Box>
      {metrics && (
        <Box flexDirection="column" marginBottom={2}>
          <Box marginY={0}>
            <Text>
              Queue Depth: <Text color="yellow">{metrics.queueDepth}</Text>
            </Text>
          </Box>
          <Box marginY={0}>
            <Text>
              Dead Letter Queue Depth: <Text color="red">{metrics.deadLetterQueueDepth}</Text>
            </Text>
          </Box>
        </Box>
      )}
      <Box marginBottom={1}>
        <Text color="cyan" bold>
          Registered Nodes ({nodeInfo.length})
        </Text>
      </Box>
      <Box flexDirection="column">
        {nodeInfo.length === 0 ? (
          <Text color="yellow">No nodes registered</Text>
        ) : (
          nodeInfo.map((node) => (
            <Box key={node.node_id} marginY={0} flexDirection="column">
              <Text>
                <Text color="green">{node.node_id}</Text>
                {node.display_name && ` (${node.display_name})`}
              </Text>
              <Text color="gray">
                Namespace: {node.namespace} | Last heartbeat: {node.last_heartbeat}
              </Text>
            </Box>
          ))
        )}
      </Box>
      <Box marginTop={2}>
        <Text color="gray">
          Press [R] to refresh, [A] to toggle auto-refresh ({autoRefresh ? "ON" : "OFF"}), ESC to go back
        </Text>
      </Box>
    </Box>
  );
}

