import { cn } from "cn";
import type { LucideIcon } from "lucide-react";
import type {
  ButtonProps as AriaButtonProps,
  ToggleButtonProps as AriaToggleButtonProps,
} from "react-aria-components";
import {
  composeRenderProps,
  Tooltip,
  TooltipTrigger,
} from "react-aria-components";

import { Button, ToggleButton } from "./button";

export const Tip = ({
  text,
  children,
}: {
  text: string;
  children: React.ReactNode;
}) => (
  <TooltipTrigger closeDelay={0} delay={500}>
    {children}
    <Tooltip
      className="border-line bg-panel rounded border px-2 py-1 text-[11px] text-slate-200 shadow-lg"
      offset={6}
    >
      {text}
    </Tooltip>
  </TooltipTrigger>
);

/** Tailwindが検出できるよう、クラス名は静的に列挙する。 */
type ToolPriority = "high" | "normal";
const labelClass: Record<ToolPriority, string> = {
  high: "hidden @3xl:inline",
  normal: "hidden @5xl:inline",
};
const badgeClass: Record<ToolPriority, string> = {
  high: "@3xl:hidden",
  normal: "@5xl:hidden",
};
const paddingClass: Record<ToolPriority, string> = {
  high: "px-1.5 @3xl:px-2.5",
  normal: "px-1.5 @5xl:px-2.5",
};

interface ToolContentProps {
  icon: LucideIcon;
  label: string;
  shortcut?: string;
  priority?: ToolPriority;
  iconOnly?: boolean;
  badge?: string;
}

const tipText = ({ label, shortcut }: ToolContentProps) =>
  shortcut === undefined ? label : `${label}（${shortcut}）`;

const ToolContent = ({
  icon: Icon,
  label,
  shortcut,
  priority = "normal",
  iconOnly = false,
  badge,
}: ToolContentProps) => (
  <>
    <Icon className="size-4 shrink-0" strokeWidth={1.75} />
    {badge === undefined ? null : (
      <span className={cn("text-[11px] tabular-nums", badgeClass[priority])}>
        {badge}
      </span>
    )}
    {iconOnly ? null : <span className={labelClass[priority]}>{label}</span>}
    {iconOnly || shortcut === undefined ? null : (
      <kbd className="hidden font-mono text-[10px] opacity-60 @6xl:inline">
        {shortcut}
      </kbd>
    )}
  </>
);

const toolClass = ({
  iconOnly = false,
  priority = "normal",
}: ToolContentProps) => (iconOnly ? "px-1.5" : paddingClass[priority]);

type ToolButtonProps = ToolContentProps &
  Omit<AriaButtonProps, "children" | "aria-label">;

export const ToolButton = ({
  icon,
  label,
  shortcut,
  priority,
  iconOnly,
  badge,
  className,
  ...props
}: ToolButtonProps) => {
  const content = { icon, label, shortcut, priority, iconOnly, badge };
  return (
    <Tip text={tipText(content)}>
      <Button
        {...props}
        aria-label={tipText(content)}
        className={composeRenderProps(className, (custom) =>
          cn(toolClass(content), custom)
        )}
        tone="ghost"
      >
        <ToolContent {...content} />
      </Button>
    </Tip>
  );
};

type ToolToggleProps = ToolContentProps &
  Omit<AriaToggleButtonProps, "children" | "aria-label">;

export const ToolToggle = ({
  icon,
  label,
  shortcut,
  priority,
  iconOnly,
  badge,
  className,
  ...props
}: ToolToggleProps) => {
  const content = { icon, label, shortcut, priority, iconOnly, badge };
  return (
    <Tip text={tipText(content)}>
      <ToggleButton
        {...props}
        aria-label={tipText(content)}
        className={composeRenderProps(className, (custom) =>
          cn(toolClass(content), custom)
        )}
      >
        <ToolContent {...content} />
      </ToggleButton>
    </Tip>
  );
};
