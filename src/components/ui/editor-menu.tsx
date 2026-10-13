import {
  Menu,
  MenuItem,
  MenuSection,
  MenuTrigger,
  Popover,
  Separator,
  SubmenuTrigger,
} from "react-aria-components";

import { Button } from "./button";

interface MenuAction {
  id: string;
  label: string;
  disabled?: boolean;
  handleAction: () => void;
  shortcut?: string;
}
export type EditorMenuEntry =
  | (MenuAction & { kind: "action" })
  | (MenuAction & { kind: "check"; checked: boolean })
  | { kind: "submenu"; id: string; label: string; entries: EditorMenuEntry[] }
  | { kind: "separator"; id: string };

const itemClass =
  "flex cursor-default items-center gap-2 rounded px-3 py-1.5 text-xs text-slate-200 outline-none data-focused:bg-white/10 data-disabled:opacity-40";
const popoverClass =
  "border-line bg-panel z-50 max-h-[85vh] overflow-auto rounded border p-1 shadow-xl";

const MenuEntries = ({
  entries,
  label,
}: {
  entries: EditorMenuEntry[];
  label: string;
}) => (
  <Menu aria-label={label} className="min-w-64 outline-none">
    {entries.map((entry) => {
      if (entry.kind === "separator") {
        return (
          <Separator key={entry.id} className="border-line my-1 border-t" />
        );
      }
      if (entry.kind === "submenu") {
        return (
          <SubmenuTrigger key={entry.id}>
            <MenuItem
              id={entry.id}
              textValue={entry.label}
              className={itemClass}
            >
              <span className="w-3" />
              <span>{entry.label}</span>
              <span aria-hidden="true" className="ml-auto">
                ›
              </span>
            </MenuItem>
            <Popover className={popoverClass}>
              <MenuEntries entries={entry.entries} label={entry.label} />
            </Popover>
          </SubmenuTrigger>
        );
      }
      const item = (
        <MenuItem
          id={entry.id}
          textValue={entry.label}
          className={itemClass}
          shouldCloseOnSelect
          isDisabled={entry.disabled}
          onAction={entry.handleAction}
        >
          <span aria-hidden="true" className="w-3">
            {entry.kind === "check" && entry.checked ? "✓" : ""}
          </span>
          <span>{entry.label}</span>
          {entry.shortcut === undefined ? null : (
            <kbd className="ml-auto font-mono text-[10px] opacity-60">
              {entry.shortcut}
            </kbd>
          )}
        </MenuItem>
      );
      return entry.kind === "check" ? (
        <MenuSection
          key={entry.id}
          selectionMode="multiple"
          selectedKeys={entry.checked ? [entry.id] : []}
        >
          {item}
        </MenuSection>
      ) : (
        <MenuSection key={entry.id}>{item}</MenuSection>
      );
    })}
  </Menu>
);

export const EditorMenu = ({
  label,
  entries,
}: {
  label: string;
  entries: EditorMenuEntry[];
}) => (
  <MenuTrigger>
    <Button>{label}</Button>
    <Popover placement="bottom start" className={popoverClass}>
      <MenuEntries entries={entries} label={label} />
    </Popover>
  </MenuTrigger>
);
