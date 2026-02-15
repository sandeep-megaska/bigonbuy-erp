import type { ReactNode } from "react";
import { table, tableWrap } from "../tw";

type ErpTableProps = {
  children: ReactNode;
};

export default function ErpTable({ children }: ErpTableProps) {
  return (
    <div className={tableWrap}>
      <table className={table}>{children}</table>
    </div>
  );
}
