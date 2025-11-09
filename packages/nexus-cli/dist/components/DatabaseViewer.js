import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect, useCallback } from "react";
import { Box, Text, useInput } from "ink";
export function DatabaseViewer({ system }) {
    const [tables, setTables] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [selectedTableIndex, setSelectedTableIndex] = useState(null);
    const [tableData, setTableData] = useState([]);
    const [loadingData, setLoadingData] = useState(false);
    const loadTables = useCallback(async () => {
        try {
            setLoading(true);
            const db = system.getDatabase();
            const result = await db.query(`
        SELECT 
          table_schema,
          table_name,
          COALESCE(n_tup_ins, 0)::text as row_count
        FROM information_schema.tables t
        LEFT JOIN pg_stat_user_tables s ON s.schemaname = t.table_schema AND s.relname = t.table_name
        WHERE table_schema IN ('core', 'pgmq', 'cron', 'partman')
        ORDER BY table_schema, table_name
      `);
            setTables(result.rows.map((row) => ({
                schema: row.table_schema ?? "",
                table: row.table_name ?? "",
                rowCount: Number.parseInt(row.row_count ?? "0", 10)
            })));
            setError(null);
        }
        catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        }
        finally {
            setLoading(false);
        }
    }, [system]);
    const loadTableData = useCallback(async (tableName) => {
        try {
            setLoadingData(true);
            const db = system.getDatabase();
            const [schema, table] = tableName.split(".");
            const result = await db.query(`SELECT * FROM ${schema}.${table} LIMIT 100`);
            setTableData(result.rows);
            setError(null);
        }
        catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        }
        finally {
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
        }
        else if (key.upArrow && selectedTableIndex === null) {
            // Navigate table list
            setSelectedTableIndex(tables.length > 0 ? tables.length - 1 : null);
        }
        else if (key.downArrow && selectedTableIndex === null) {
            setSelectedTableIndex(0);
        }
        else if (key.upArrow && selectedTableIndex !== null && selectedTableIndex > 0) {
            setSelectedTableIndex(selectedTableIndex - 1);
        }
        else if (key.downArrow && selectedTableIndex !== null && selectedTableIndex < tables.length - 1) {
            setSelectedTableIndex(selectedTableIndex + 1);
        }
        else if (key.return && selectedTableIndex === null && tables.length > 0) {
            setSelectedTableIndex(0);
        }
    });
    if (loading) {
        return (_jsx(Box, { padding: 1, children: _jsx(Text, { color: "cyan", children: "Loading tables..." }) }));
    }
    if (error) {
        return (_jsx(Box, { padding: 1, children: _jsxs(Text, { color: "red", children: ["Error: ", error] }) }));
    }
    if (selectedTableIndex !== null && tables[selectedTableIndex]) {
        const selectedTable = tables[selectedTableIndex];
        const tableName = `${selectedTable.schema}.${selectedTable.table}`;
        return (_jsxs(Box, { flexDirection: "column", padding: 1, children: [_jsx(Box, { marginBottom: 1, children: _jsxs(Text, { color: "cyan", bold: true, children: ["Table: ", tableName] }) }), loadingData ? (_jsx(Text, { children: "Loading data..." })) : (_jsx(Box, { flexDirection: "column", children: tableData.length === 0 ? (_jsx(Text, { color: "yellow", children: "No rows found" })) : (_jsxs(Box, { flexDirection: "column", children: [tableData.slice(0, 20).map((row, idx) => (_jsx(Box, { marginY: 0, flexDirection: "column", children: _jsxs(Text, { children: [JSON.stringify(row, null, 2)
                                            .split("\n")
                                            .slice(0, 5)
                                            .join("\n"), JSON.stringify(row).length > 200 ? "..." : ""] }) }, idx))), tableData.length > 20 && (_jsxs(Text, { color: "gray", children: ["... and ", tableData.length - 20, " more rows"] }))] })) })), _jsx(Box, { marginTop: 1, children: _jsx(Text, { color: "gray", children: "Press ESC to go back" }) })] }));
    }
    return (_jsxs(Box, { flexDirection: "column", padding: 1, children: [_jsx(Box, { marginBottom: 1, children: _jsx(Text, { color: "cyan", bold: true, children: "Database Tables" }) }), _jsx(Box, { flexDirection: "column", children: tables.map((table, idx) => (_jsx(Box, { marginY: 0, children: _jsxs(Text, { color: idx === selectedTableIndex ? "green" : "white", children: [idx === selectedTableIndex ? "> " : "  ", table.schema, ".", table.table, " (", table.rowCount, " rows)"] }) }, `${table.schema}.${table.table}`))) }), _jsx(Box, { marginTop: 1, children: _jsx(Text, { color: "gray", children: "Use arrow keys to navigate, Enter to view table data, ESC to go back" }) })] }));
}
//# sourceMappingURL=DatabaseViewer.js.map