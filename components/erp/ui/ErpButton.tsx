import type { ButtonHTMLAttributes, CSSProperties } from "react";
import { ghostButtonStyle, primaryButtonStyle, secondaryButtonStyle } from "./styles";

type ErpButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost";
};

const variantStyle: Record<NonNullable<ErpButtonProps["variant"]>, CSSProperties> = {
  primary: primaryButtonStyle,
  secondary: secondaryButtonStyle,
  ghost: ghostButtonStyle,
};

export default function ErpButton({ variant = "primary", style, ...props }: ErpButtonProps) {
  return <button type="button" {...props} style={{ ...variantStyle[variant], ...style }} />;
}
