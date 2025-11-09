import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
export function MetricsViewer({ system }) {
    const [metrics, setMetrics] = useState(null);
    const [nodeInfo, setNodeInfo] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
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
                system.getDatabase().query(`
          SELECT node_id, display_name, namespace, last_heartbeat
          FROM core.nodes
          ORDER BY last_heartbeat DESC
        `)
            ]);
            setMetrics(metricsData);
            setNodeInfo(nodesResult.rows);
            setError(null);
        }
        catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        }
        finally {
            setLoading(false);
        }
    };
    useInput((input, key) => {
        if (input === "r" || input === "R") {
            loadMetrics();
        }
        else if (input === "a" || input === "A") {
            setAutoRefresh((prev) => !prev);
        }
    });
    if (loading && !metrics) {
        return (_jsx(Box, { padding: 1, children: _jsx(Text, { color: "cyan", children: "Loading metrics..." }) }));
    }
    if (error) {
        return (_jsx(Box, { padding: 1, children: _jsxs(Text, { color: "red", children: ["Error: ", error] }) }));
    }
    return (_jsxs(Box, { flexDirection: "column", padding: 1, children: [_jsx(Box, { marginBottom: 1, children: _jsx(Text, { color: "cyan", bold: true, children: "System Metrics" }) }), metrics && (_jsxs(Box, { flexDirection: "column", marginBottom: 2, children: [_jsx(Box, { marginY: 0, children: _jsxs(Text, { children: ["Queue Depth: ", _jsx(Text, { color: "yellow", children: metrics.queueDepth })] }) }), _jsx(Box, { marginY: 0, children: _jsxs(Text, { children: ["Dead Letter Queue Depth: ", _jsx(Text, { color: "red", children: metrics.deadLetterQueueDepth })] }) })] })), _jsx(Box, { marginBottom: 1, children: _jsxs(Text, { color: "cyan", bold: true, children: ["Registered Nodes (", nodeInfo.length, ")"] }) }), _jsx(Box, { flexDirection: "column", children: nodeInfo.length === 0 ? (_jsx(Text, { color: "yellow", children: "No nodes registered" })) : (nodeInfo.map((node) => (_jsxs(Box, { marginY: 0, flexDirection: "column", children: [_jsxs(Text, { children: [_jsx(Text, { color: "green", children: node.node_id }), node.display_name && ` (${node.display_name})`] }), _jsxs(Text, { color: "gray", children: ["Namespace: ", node.namespace, " | Last heartbeat: ", node.last_heartbeat] })] }, node.node_id)))) }), _jsx(Box, { marginTop: 2, children: _jsxs(Text, { color: "gray", children: ["Press [R] to refresh, [A] to toggle auto-refresh (", autoRefresh ? "ON" : "OFF", "), ESC to go back"] }) })] }));
}
//# sourceMappingURL=MetricsViewer.js.map