import { cn } from "cn";
import type {
  ButtonProps as AriaButtonProps,
  ToggleButtonProps as AriaToggleButtonProps,
} from "react-aria-components";
import {
  Button as AriaButton,
  composeRenderProps,
  ToggleButton as AriaToggleButton,
} from "react-aria-components";

type Tone = "default" | "primary" | "danger" | "ghost";

const toneClass: Record<Tone, string> = {
  danger: "bg-red-500/80 text-white data-hovered:bg-red-500",
  default: "bg-white/8 text-slate-100 data-hovered:bg-white/14",
  ghost: "bg-transparent text-slate-300 data-hovered:bg-white/10",
  primary: "bg-accent text-slate-950 data-hovered:brightness-110",
};

const base =
  "inline-flex h-7 shrink-0 cursor-default items-center justify-center gap-1.5 rounded px-2.5 text-xs font-medium whitespace-nowrap outline-none transition data-disabled:opacity-40 data-focus-visible:ring-2 data-focus-visible:ring-accent data-pressed:brightness-90";

export interface ButtonProps extends AriaButtonProps {
  tone?: Tone;
}

export const Button = ({
  tone = "default",
  className,
  ...props
}: ButtonProps) => (
  <AriaButton
    {...props}
    className={composeRenderProps(className, (custom) =>
      cn(base, toneClass[tone], custom)
    )}
  />
);

export const ToggleButton = ({
  className,
  ...props
}: AriaToggleButtonProps) => (
  <AriaToggleButton
    {...props}
    className={composeRenderProps(className, (custom) =>
      cn(
        base,
        "data-selected:bg-accent bg-white/8 text-slate-200 data-hovered:bg-white/14 data-selected:text-slate-950",
        custom
      )
    )}
  />
);
