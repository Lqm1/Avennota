import { ListPlus, Redo2, Undo2 } from "lucide-react";
import { Separator, Toolbar as AriaToolbar } from "react-aria-components";

import { SearchBox } from "../../components/ui/field";
import { ToolButton } from "../../components/ui/tool-button";
import { FileMenu, ViewMenu, OptionsMenu, ToolsMenu } from "./editor-menus";
import { redo, undo } from "./store";
import type { OpenWorkspace } from "./store";

interface ToolbarProps {
  workspace: OpenWorkspace;
  query: string;
  onQueryChange: (query: string) => void;
  onSearch: () => void;
  searchRef: React.Ref<HTMLInputElement>;
  unlistedCount: number;
  onAddUnlisted: () => void;
}

export const divider = (
  <Separator
    className="bg-line mx-1 h-5 w-px shrink-0"
    orientation="vertical"
  />
);

export const Toolbar = ({
  workspace,
  query,
  onQueryChange,
  onSearch,
  searchRef,
  unlistedCount,
  onAddUnlisted,
}: ToolbarProps) => {
  const canUndo = workspace.history.past.length > 0;
  const canRedo = workspace.history.future.length > 0;
  return (
    <AriaToolbar
      aria-label="メインツールバー"
      className="border-line bg-panel @container flex shrink-0 flex-nowrap items-center gap-1 border-b px-2 py-1.5"
    >
      <FileMenu />
      <ViewMenu />
      <OptionsMenu />
      <ToolsMenu />
      {divider}
      <ToolButton
        icon={Undo2}
        isDisabled={!canUndo}
        label="元に戻す"
        priority="high"
        onPress={undo}
        shortcut="Ctrl+Z"
      />
      <ToolButton
        icon={Redo2}
        isDisabled={!canRedo}
        label="やり直す"
        priority="high"
        onPress={redo}
        shortcut="Ctrl+Y"
      />
      {unlistedCount > 0 ? (
        <>
          {divider}
          <ToolButton
            badge={String(unlistedCount)}
            className="text-amber-300"
            icon={ListPlus}
            label={`未登録WAVを追加（${unlistedCount}件）`}
            onPress={onAddUnlisted}
          />
        </>
      ) : null}
      <SearchBox
        className="ml-auto w-40 min-w-28 shrink @3xl:w-56"
        inputRef={searchRef}
        onChange={onQueryChange}
        onSubmit={onSearch}
        value={query}
      />
    </AriaToolbar>
  );
};
