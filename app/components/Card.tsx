// components/Card.tsx
import React, { ReactNode } from "react";

type CardProps = {
  children: ReactNode;
  title?: string;
  className?: string;
};

export function Card({ children, title, className = "" }: CardProps) {
  return (
    <div className={`bg-white rounded-xl shadow p-6 ${className}`}>
      {title && <h2 className="text-lg font-semibold mb-4">{title}</h2>}
      {children}
    </div>
  );
}
