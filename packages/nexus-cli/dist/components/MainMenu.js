import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { Box, Text, useInput } from "ink";
const menuItems = [
    { key: "1", label: "View Database Tables", view: "database" },
    { key: "2", label: "Run SQL Query", view: "query" },
    { key: "3", label: "View System Metrics", view: "metrics" },
    { key: "q", label: "Quit", view: null }
];
export function MainMenu({ onSelect }) {
    const [selectedIndex, setSelectedIndex] = useState(0);
    useInput((input, key) => {
        if (key.upArrow) {
            setSelectedIndex((prev) => (prev > 0 ? prev - 1 : menuItems.length - 1));
        }
        else if (key.downArrow) {
            setSelectedIndex((prev) => (prev < menuItems.length - 1 ? prev + 1 : 0));
        }
        else if (key.return) {
            const item = menuItems[selectedIndex];
            if (item && item.view) {
                onSelect(item.view);
            }
            else {
                process.exit(0);
            }
        }
        else if (input === "q" || input === "Q") {
            process.exit(0);
        }
        else {
            const itemIndex = menuItems.findIndex((item) => item.key === input);
            if (itemIndex !== -1) {
                const item = menuItems[itemIndex];
                if (item && item.view) {
                    onSelect(item.view);
                }
                else {
                    process.exit(0);
                }
            }
        }
    });
    return (_jsxs(Box, { flexDirection: "column", padding: 1, children: [_jsx(Box, { marginBottom: 1, children: _jsx(Text, { color: "cyan", bold: true, children: "Nexus CLI - Database Interrogation Tool" }) }), _jsx(Box, { marginBottom: 1, children: _jsx(Text, { children: "Use arrow keys to navigate, Enter to select, or press the number/key" }) }), _jsx(Box, { flexDirection: "column", marginTop: 1, children: menuItems.map((item, index) => (_jsx(Box, { marginY: 0, children: _jsxs(Text, { color: index === selectedIndex ? "green" : "white", children: [index === selectedIndex ? "> " : "  ", "[", item.key, "] ", item.label] }) }, item.key))) }), _jsx(Box, { marginTop: 2, children: _jsx(Text, { color: "gray", children: "Press ESC to go back (when in a submenu)" }) })] }));
}
//# sourceMappingURL=MainMenu.js.map