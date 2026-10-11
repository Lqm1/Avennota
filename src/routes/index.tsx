import { createFileRoute } from "@tanstack/react-router";

import { EditorScreen } from "../features/editor/editor-screen";

export const Route = createFileRoute("/")({
  component: EditorScreen,
});
