import React, { useState, useEffect, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import type { CoreSystem } from "@nexus-core/core";

interface DatabaseViewerProps {
  system: CoreSystem;
}

interface TableInfo {
  schema: string;
  table: string;
  rowCount: number;
}

export function DatabaseViewer({ system }: DatabaseViewerProps) {
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTableIndex, setSelectedTableIndex] = useState<number | null>(null);
  const [tableData, setTableData] = useState<Record<string, unknown>[]>([]);
  const [loadingData, setLoadingData] = useState(false);

  const loadTables = useCallback(async () => {
    try {
      setLoading(true);
      const db = system.getDatabase();
      const result = await db.query<{
        table_schema: string;
        table_name: string;
        row_count: string;
      }>(`
        SELECT 
          table_schema,
          table_name,
          COALESCE(n_tup_ins, 0)::text as row_count
        FROM information_schema.tables t
        LEFT JOIN pg_stat_user_tables s ON s.schemaname = t.table_schema AND s.relname = t.table_name
        WHERE table_schema IN ('core', 'pgmq', 'cron', 'partman')
        ORDER BY table_schema, table_name
      `);

      setTables(
        result.rows.map((row) => ({
          schema: row.table_schema ?? "",
          table: row.table_name ?? "",
          rowCount: Number.parseInt(row.row_count ?? "0", 10)
        }))
      );
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [system]);

  const loadTableData = useCallback(async (tableName: string) => {
    try {
      setLoadingData(true);
      const db = system.getDatabase();
      const [schema, table] = tableName.split(".");
      const result = await db.query(`SELECT * FROM ${schema}.${table} LIMIT 100`);

      setTableData(result.rows);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingData(false);
    }
  }, [system]);

  useEffect(() => {
    loadTables();
  }, [loadTables]);

  useEffect(() => {
    if (selectedTableIndex !== null && tables[selectedTableIndex]) {
      const table = tables[selectedTableIndex];
      loadTableData(`${table.schema}.${table.table}`);
    }
  }, [selectedTableIndex, tables, loadTableData]);


  useInput((input, key) => {
    if (key.escape) {
      setSelectedTableIndex(null);
      setTableData([]);
    } else if (key.upArrow && selectedTableIndex === null) {
      // Navigate table list
      setSelectedTableIndex(tables.length > 0 ? tables.length - 1 : null);
    } else if (key.downArrow && selectedTableIndex === null) {
      setSelectedTableIndex(0);
    } else if (key.upArrow && selectedTableIndex !== null && selectedTableIndex > 0) {
      setSelectedTableIndex(selectedTableIndex - 1);
    } else if (key.downArrow && selectedTableIndex !== null && selectedTableIndex < tables.length - 1) {
      setSelectedTableIndex(selectedTableIndex + 1);
    } else if (key.return && selectedTableIndex === null && tables.length > 0) {
      setSelectedTableIndex(0);
    }
  });

  if (loading) {
    return (
      <Box padding={1}>
        <Text color="cyan">Loading tables...</Text>
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

  if (selectedTableIndex !== null && tables[selectedTableIndex]) {
    const selectedTable = tables[selectedTableIndex];
    const tableName = `${selectedTable.schema}.${selectedTable.table}`;
    return (
      <Box flexDirection="column" padding={1}>
        <Box marginBottom={1}>
          <Text color="cyan" bold>
            Table: {tableName}
          </Text>
        </Box>
        {loadingData ? (
          <Text>Loading data...</Text>
        ) : (
          <Box flexDirection="column">
            {tableData.length === 0 ? (
              <Text color="yellow">No rows found</Text>
            ) : (
              <Box flexDirection="column">
                {tableData.slice(0, 20).map((row, idx) => (
                  <Box key={idx} marginY={0} flexDirection="column">
                    <Text>
                      {JSON.stringify(row, null, 2)
                        .split("\n")
                        .slice(0, 5)
                        .join("\n")}
                      {JSON.stringify(row).length > 200 ? "..." : ""}
                    </Text>
                  </Box>
                ))}
                {tableData.length > 20 && (
                  <Text color="gray">... and {tableData.length - 20} more rows</Text>
                )}
              </Box>
            )}
          </Box>
        )}
        <Box marginTop={1}>
          <Text color="gray">Press ESC to go back</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text color="cyan" bold>
          Database Tables
        </Text>
      </Box>
      <Box flexDirection="column">
        {tables.map((table, idx) => (
          <Box key={`${table.schema}.${table.table}`} marginY={0}>
            <Text color={idx === selectedTableIndex ? "green" : "white"}>
              {idx === selectedTableIndex ? "> " : "  "}
              {table.schema}.{table.table} ({table.rowCount} rows)
            </Text>
          </Box>
        ))}
      </Box>
      <Box marginTop={1}>
        <Text color="gray">Use arrow keys to navigate, Enter to view table data, ESC to go back</Text>
      </Box>
    </Box>
  );
}

