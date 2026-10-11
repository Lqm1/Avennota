import { CheckboxField, CheckboxButton } from "react-aria-components";

export const Check = ({
  label,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) => (
  <CheckboxField
    isSelected={value}
    isDisabled={disabled}
    onChange={onChange}
    className="text-xs text-slate-200"
  >
    <CheckboxButton className="group flex cursor-default items-center gap-2">
      <span
        className="border-line group-data-selected:bg-accent group-data-focus-visible:ring-accent flex h-4 w-4 items-center justify-center rounded border group-data-focus-visible:ring-2 group-data-selected:text-slate-950"
        aria-hidden="true"
      >
        {value ? "✓" : ""}
      </span>
      {label}
    </CheckboxButton>
  </CheckboxField>
);
