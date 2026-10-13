import { cn } from "cn";
import { ChevronDown, Search } from "lucide-react";
import { useState } from "react";
import {
  Button as AriaButton,
  Group,
  Input,
  Label,
  ListBox,
  ListBoxItem,
  NumberField as AriaNumberField,
  Popover,
  SearchField as AriaSearchField,
  Select as AriaSelect,
  SelectValue,
  TextArea,
  TextField as AriaTextField,
} from "react-aria-components";

const inputClass =
  "h-7 w-full min-w-0 rounded border border-line bg-black/25 px-2 text-xs text-slate-100 outline-none placeholder:text-slate-500 data-focused:border-accent data-invalid:border-red-400";

interface CommitTextFieldProps {
  label: string;
  value: string;
  onCommit: (value: string) => void;
  hideLabel?: boolean;
  className?: string;
  isDisabled?: boolean;
  errorText?: string;
}

export const CommitTextField = ({
  label,
  value,
  onCommit,
  hideLabel = false,
  className = "",
  isDisabled = false,
  errorText = "",
}: CommitTextFieldProps) => {
  const [draft, setDraft] = useState(value);
  // 外から値が変わったら（元に戻す操作や行の切り替え）、編集中の文字列を置き換える。
  const [source, setSource] = useState(value);
  if (source !== value) {
    setSource(value);
    setDraft(value);
  }
  const commit = () => {
    if (draft !== value) {
      onCommit(draft);
    }
  };
  return (
    <AriaTextField
      className={cn("flex flex-col gap-1", className)}
      isDisabled={isDisabled}
      isInvalid={Boolean(errorText)}
      onBlur={commit}
      onChange={setDraft}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          commit();
        } else if (event.key === "Escape") {
          setDraft(value);
        }
      }}
      value={draft}
    >
      <Label className={hideLabel ? "sr-only" : "text-[11px] text-slate-400"}>
        {label}
      </Label>
      <Input className={inputClass} spellCheck={false} />
      {errorText === "" ? null : (
        <span className="text-[11px] text-red-300">{errorText}</span>
      )}
    </AriaTextField>
  );
};

export const TextAreaField = ({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) => (
  <AriaTextField
    className="flex flex-col gap-1"
    onChange={onChange}
    value={value}
  >
    <Label className="text-[11px] text-slate-400">{label}</Label>
    <TextArea
      className={cn(inputClass, "h-auto py-1 font-mono")}
      rows={6}
      spellCheck={false}
    />
  </AriaTextField>
);

interface MsFieldProps {
  label: string;
  value: number;
  onCommit: (value: number) => void;
  swatch: React.ReactNode;
  hint?: string;
  isDisabled?: boolean;
}

/** React AriaのNumberFieldは確定時にonChangeを呼ぶ。 */
export const MsField = ({
  label,
  value,
  onCommit,
  swatch,
  hint = "",
  isDisabled = false,
}: MsFieldProps) => (
  <AriaNumberField
    className="flex min-w-0 flex-col gap-1"
    formatOptions={{ maximumFractionDigits: 3, useGrouping: false }}
    isDisabled={isDisabled}
    onChange={(next) => {
      if (Number.isFinite(next) && !Object.is(next, value)) {
        onCommit(next);
      }
    }}
    value={value}
  >
    <Label className="flex items-center gap-1.5 text-[11px] text-slate-400">
      {swatch}
      <span className="truncate">{label}</span>
      {hint === "" ? null : (
        <kbd className="ml-auto font-mono text-[10px] text-slate-500">
          {hint}
        </kbd>
      )}
    </Label>
    <Group className="flex">
      <Input className={cn(inputClass, "text-right font-mono tabular-nums")} />
    </Group>
  </AriaNumberField>
);

export interface SelectOption<T extends string> {
  id: T;
  label: string;
}

interface SelectFieldProps<T extends string> {
  label: string;
  value: T | null;
  options: readonly SelectOption<T>[];
  onChange: (value: T) => void;
  hideLabel?: boolean;
  isDisabled?: boolean;
  className?: string;
  triggerClassName?: string;
  placeholder?: string;
}

export const SelectField = <T extends string>({
  label,
  value,
  options,
  onChange,
  hideLabel = false,
  isDisabled = false,
  className = "",
  triggerClassName = "",
  placeholder = "",
}: SelectFieldProps<T>) => (
  <AriaSelect
    aria-label={label}
    className={cn("flex flex-col gap-1", className)}
    isDisabled={isDisabled}
    onChange={(key) => {
      const option = options.find((candidate) => candidate.id === key);
      if (option !== undefined) {
        onChange(option.id);
      }
    }}
    placeholder={placeholder}
    value={value}
  >
    {hideLabel ? null : (
      <Label className="text-[11px] text-slate-400">{label}</Label>
    )}
    <AriaButton
      className={cn(
        inputClass,
        "flex items-center justify-between gap-2 text-left data-disabled:opacity-40",
        triggerClassName
      )}
    >
      <SelectValue className="truncate data-placeholder:text-slate-500" />
      <ChevronDown className="size-3.5 shrink-0 text-slate-500" />
    </AriaButton>
    <Popover className="border-line bg-panel max-h-72 min-w-(--trigger-width) overflow-auto rounded border py-1 shadow-xl">
      <ListBox className="outline-none" items={options}>
        {(option) => (
          <ListBoxItem
            className="data-selected:text-accent cursor-default px-3 py-1 text-xs text-slate-200 outline-none data-focused:bg-white/10"
            id={option.id}
            textValue={option.label}
          >
            {option.label}
          </ListBoxItem>
        )}
      </ListBox>
    </Popover>
  </AriaSelect>
);

interface SearchBoxProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  inputRef: React.Ref<HTMLInputElement>;
  className?: string;
}

export const SearchBox = ({
  value,
  onChange,
  onSubmit,
  inputRef,
  className = "w-48",
}: SearchBoxProps) => (
  <AriaSearchField
    aria-label="エイリアス・ファイル名を検索"
    className={cn("relative", className)}
    onChange={onChange}
    onSubmit={onSubmit}
    value={value}
  >
    <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-slate-500" />
    <Input
      className={cn(inputClass, "pl-7")}
      placeholder="検索（Ctrl+F）"
      ref={inputRef}
    />
  </AriaSearchField>
);
