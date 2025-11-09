import { jsxs as _jsxs, jsx as _jsx } from "react/jsx-runtime";
import { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import { MainMenu } from "./components/MainMenu.js";
import { DatabaseViewer } from "./components/DatabaseViewer.js";
import { QueryRunner } from "./components/QueryRunner.js";
import { MetricsViewer } from "./components/MetricsViewer.js";
import { CoreSystem } from "@nexus-core/core";
export function App({ connectionString, namespace }) {
    const [view, setView] = useState("main");
    const [system, setSystem] = useState(null);
    const [error, setError] = useState(null);
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
        return (_jsxs(Box, { flexDirection: "column", padding: 1, children: [_jsxs(Text, { color: "red", children: ["Error connecting to database: ", error] }), _jsx(Text, { children: "Press Ctrl+C to exit" })] }));
    }
    if (!system) {
        return (_jsx(Box, { padding: 1, children: _jsx(Text, { color: "cyan", children: "Connecting to database..." }) }));
    }
    return (_jsxs(Box, { flexDirection: "column", height: "100%", children: [view === "main" && _jsx(MainMenu, { onSelect: setView }), view === "database" && _jsx(DatabaseViewer, { system: system }), view === "query" && _jsx(QueryRunner, { system: system }), view === "metrics" && _jsx(MetricsViewer, { system: system })] }));
}
//# sourceMappingURL=app.js.map