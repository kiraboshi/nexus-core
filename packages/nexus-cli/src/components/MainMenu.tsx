import React, { useState } from "react";
import { Box, Text, useInput } from "ink";

interface MainMenuProps {
  onSelect: (view: "main" | "database" | "query" | "metrics") => void;
}

const menuItems = [
  { key: "1", label: "View Database Tables", view: "database" as const },
  { key: "2", label: "Run SQL Query", view: "query" as const },
  { key: "3", label: "View System Metrics", view: "metrics" as const },
  { key: "q", label: "Quit", view: null }
];

export function MainMenu({ onSelect }: MainMenuProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  useInput((input, key) => {
    if (key.upArrow) {
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : menuItems.length - 1));
    } else if (key.downArrow) {
      setSelectedIndex((prev) => (prev < menuItems.length - 1 ? prev + 1 : 0));
    } else if (key.return) {
      const item = menuItems[selectedIndex];
      if (item && item.view) {
        onSelect(item.view);
      } else {
        process.exit(0);
      }
    } else if (input === "q" || input === "Q") {
      process.exit(0);
    } else {
      const itemIndex = menuItems.findIndex((item) => item.key === input);
      if (itemIndex !== -1) {
        const item = menuItems[itemIndex];
        if (item && item.view) {
          onSelect(item.view);
        } else {
          process.exit(0);
        }
      }
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text color="cyan" bold>
          Nexus CLI - Database Interrogation Tool
        </Text>
      </Box>
      <Box marginBottom={1}>
        <Text>Use arrow keys to navigate, Enter to select, or press the number/key</Text>
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {menuItems.map((item, index) => (
          <Box key={item.key} marginY={0}>
            <Text color={index === selectedIndex ? "green" : "white"}>
              {index === selectedIndex ? "> " : "  "}
              [{item.key}] {item.label}
            </Text>
          </Box>
        ))}
      </Box>
      <Box marginTop={2}>
        <Text color="gray">Press ESC to go back (when in a submenu)</Text>
      </Box>
    </Box>
  );
}

