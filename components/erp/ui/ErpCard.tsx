import type { CSSProperties, ReactNode } from "react";
import { card, cardHeader, cardSub, cardTitle } from "../tw";

type ErpCardProps = {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  style?: CSSProperties;
};

export default function ErpCard({ title, subtitle, actions, children, style }: ErpCardProps) {
  return (
    <section className={card} style={style}>
      {title || subtitle || actions ? (
        <header className={cardHeader}>
          <div>
            {subtitle ? <div className={cardSub}>{subtitle}</div> : null}
            {title ? <div className={cardTitle}>{title}</div> : null}
          </div>
          {actions ? <div>{actions}</div> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}
