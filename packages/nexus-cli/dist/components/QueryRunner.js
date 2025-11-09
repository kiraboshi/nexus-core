import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { Box, Text, useInput } from "ink";
const EXAMPLE_QUERIES = [
    "SELECT * FROM core.nodes LIMIT 10;",
    "SELECT * FROM pgmq.meta;",
    "SELECT COUNT(*) FROM core.event_log;",
    "SELECT * FROM core.scheduled_tasks;",
    "SELECT namespace, COUNT(*) FROM core.event_log GROUP BY namespace;"
];
export function QueryRunner({ system }) {
    const [selectedQueryIndex, setSelectedQueryIndex] = useState(0);
    const [query, setQuery] = useState(EXAMPLE_QUERIES[0] ?? "");
    const [results, setResults] = useState(null);
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(false);
    const executeQuery = async (sqlQuery) => {
        if (!sqlQuery.trim()) {
            return;
        }
        try {
            setLoading(true);
            setError(null);
            const db = system.getDatabase();
            const result = await db.query(sqlQuery.trim());
            setResults(result.rows);
        }
        catch (err) {
            setError(err instanceof Error ? err.message : String(err));
            setResults(null);
        }
        finally {
            setLoading(false);
        }
    };
    useInput((input, key) => {
        if (key.escape) {
            setQuery("");
            setResults(null);
            setError(null);
            setSelectedQueryIndex(0);
        }
        else if (key.upArrow) {
            const newIndex = selectedQueryIndex > 0 ? selectedQueryIndex - 1 : EXAMPLE_QUERIES.length - 1;
            setSelectedQueryIndex(newIndex);
            setQuery(EXAMPLE_QUERIES[newIndex] ?? "");
        }
        else if (key.downArrow) {
            const newIndex = selectedQueryIndex < EXAMPLE_QUERIES.length - 1 ? selectedQueryIndex + 1 : 0;
            setSelectedQueryIndex(newIndex);
            setQuery(EXAMPLE_QUERIES[newIndex] ?? "");
        }
        else if (key.return) {
            executeQuery(query);
        }
    });
    return (_jsxs(Box, { flexDirection: "column", padding: 1, children: [_jsx(Box, { marginBottom: 1, children: _jsx(Text, { color: "cyan", bold: true, children: "SQL Query Runner" }) }), _jsxs(Box, { marginBottom: 1, flexDirection: "column", children: [_jsx(Text, { color: "gray", children: "Select a query (use arrow keys, Enter to execute):" }), _jsx(Box, { flexDirection: "column", marginTop: 1, children: EXAMPLE_QUERIES.map((exampleQuery, idx) => (_jsx(Box, { marginY: 0, children: _jsxs(Text, { color: idx === selectedQueryIndex ? "green" : "white", children: [idx === selectedQueryIndex ? "> " : "  ", exampleQuery] }) }, idx))) }), _jsxs(Box, { borderStyle: "single", padding: 1, marginTop: 1, children: [_jsx(Text, { color: "cyan", children: "Current query:" }), _jsx(Text, { children: query || " " }), loading && _jsx(Text, { color: "yellow", children: " (executing...)" })] })] }), error && (_jsx(Box, { marginBottom: 1, children: _jsxs(Text, { color: "red", children: ["Error: ", error] }) })), results && (_jsxs(Box, { flexDirection: "column", marginTop: 1, children: [_jsxs(Text, { color: "green", bold: true, children: ["Results (", results.length, " rows):"] }), _jsxs(Box, { flexDirection: "column", marginTop: 1, children: [results.slice(0, 50).map((row, idx) => (_jsx(Box, { marginY: 0, flexDirection: "column", children: _jsxs(Text, { children: [JSON.stringify(row, null, 2)
                                            .split("\n")
                                            .slice(0, 10)
                                            .join("\n"), JSON.stringify(row).length > 500 ? "..." : ""] }) }, idx))), results.length > 50 && (_jsxs(Text, { color: "gray", children: ["... and ", results.length - 50, " more rows"] }))] })] })), _jsx(Box, { marginTop: 2, children: _jsx(Text, { color: "gray", children: "Use Up/Down arrows to select query, Enter to execute, ESC to go back" }) })] }));
}
//# sourceMappingURL=QueryRunner.js.map