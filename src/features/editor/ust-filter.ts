import { createStore } from "@tanstack/react-store";

export const ustFilterStore = createStore<Set<string> | null>(null);
