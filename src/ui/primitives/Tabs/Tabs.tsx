"use client";

import { useState, type KeyboardEvent, type ReactNode } from "react";
import styles from "./Tabs.module.css";

export interface TabItem {
  value: string;
  label: ReactNode;
  content: ReactNode;
}

export interface TabsProps {
  items: TabItem[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
}

export function Tabs({ items, value, defaultValue, onValueChange }: TabsProps) {
  const [internalValue, setInternalValue] = useState(defaultValue ?? items[0]?.value);
  const active = value ?? internalValue;

  function select(next: string) {
    setInternalValue(next);
    onValueChange?.(next);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = items.findIndex((item) => item.value === active);
    if (index === -1) return;
    if (event.key === "ArrowRight") {
      select(items[(index + 1) % items.length]!.value);
    } else if (event.key === "ArrowLeft") {
      select(items[(index - 1 + items.length) % items.length]!.value);
    }
  }

  const activeItem = items.find((item) => item.value === active);

  return (
    <div>
      <div className={styles.list} role="tablist" onKeyDown={handleKeyDown}>
        {items.map((item) => (
          <button
            key={item.value}
            role="tab"
            type="button"
            aria-selected={item.value === active}
            className={[styles.trigger, item.value === active && styles.triggerActive].filter(Boolean).join(" ")}
            onClick={() => select(item.value)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className={styles.panel} role="tabpanel">
        {activeItem?.content}
      </div>
    </div>
  );
}
