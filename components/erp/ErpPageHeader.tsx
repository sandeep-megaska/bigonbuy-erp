import type { CSSProperties, ReactNode } from "react";
import {
  eyebrowStyle,
  h1Style,
  pageHeaderStyle,
  subtitleStyle,
} from "./ui/styles";

type ErpPageHeaderProps = {
  eyebrow?: string;
  title: string;
  description?: string;
  rightActions?: ReactNode;
};

export default function ErpPageHeader({
  eyebrow,
  title,
  description,
  rightActions,
}: ErpPageHeaderProps) {
  return (
    <header style={pageHeaderStyle}>
      <div>
        {eyebrow ? <p style={eyebrowStyle}>{eyebrow}</p> : null}
        <h1 style={h1Style}>{title}</h1>
        {description ? <p style={subtitleStyle}>{description}</p> : null}
      </div>
      {rightActions ? <div style={rightActionStyle}>{rightActions}</div> : null}
    </header>
  );
}

const rightActionStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  flexWrap: "wrap",
};
