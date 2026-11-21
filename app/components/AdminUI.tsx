import {
  Children,
  isValidElement,
  useId,
  type ReactNode,
  type ButtonHTMLAttributes,
} from "react";
import { Link, NavLink } from "react-router";
import { PortalIcon } from "./PortalLayout";
import "../styles/admin.css";

const pages = [
  ["/app", "Overview", "dashboard"],
  ["/app/affiliates", "Affiliates", "dashboard"],
  ["/app/payments", "Commissions & payments", "dashboard"],
  ["/app/programs", "Programs", "dashboard"],
  ["/app/products", "Assignments", "collection"],
  ["/app/organizations", "Organizations", "collection"],
  ["/app/ingestion", "Order reporting", "dashboard"],
] as const;

export function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="partner-portal portal-shell admin-portal">
      <aside className="portal-sidebar">
        <Link className="portal-brand" to="/app">
          <span className="brand-mark">C</span>
          <span>
            CRAFTED<small>COMMISSION ADMIN</small>
          </span>
        </Link>
        <div className="partner-identity">
          <span className="partner-avatar">C</span>
          <div>
            <strong>Crafted</strong>
            <span>Manage your partnerships</span>
          </div>
        </div>
        <div className="nav-caption">WORKSPACE</div>
        <nav aria-label="Commission admin navigation">
          {pages.map(([to, label, icon]) => (
            <NavLink key={to} to={to} end={to === "/app"}>
              <PortalIcon name={icon} />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <p>
            Your partners.
            <br />
            Your commission programs.
          </p>
        </div>
      </aside>
      <main className="portal-main">
        {children}
        <footer className="portal-footer">
          Crafted commission portal<span>Partner management</span>
        </footer>
      </main>
    </div>
  );
}

export function Page({
  heading,
  children,
}: {
  heading: string;
  children: ReactNode;
}) {
  const items = Children.toArray(children);
  const breadcrumbs = items.filter(
    (child) =>
      isValidElement<{ slot?: string }>(child) &&
      child.props.slot === "breadcrumb-actions",
  );
  return (
    <>
      <header className="portal-page-header">
        <div>
          <p className="eyebrow">CRAFTED · PARTNER MANAGEMENT</p>
          {breadcrumbs.length > 0 && (
            <div className="admin-breadcrumb">{breadcrumbs}</div>
          )}
          <h1>{heading}</h1>
        </div>
        <span className="account-badge">
          <span />
          Shopify admin
        </span>
      </header>
      {items.filter((child) => !breadcrumbs.includes(child))}
    </>
  );
}
export function Section({
  heading,
  children,
}: {
  heading: string;
  children: ReactNode;
}) {
  return (
    <section className="portal-section admin-section">
      <div className="section-heading">
        <h2>{heading}</h2>
      </div>
      <div className="admin-section-body">{children}</div>
    </section>
  );
}
export function Stack({
  children,
  direction,
}: {
  children: ReactNode;
  direction?: string;
  gap?: string;
}) {
  return (
    <div
      className={`admin-stack ${direction === "inline" ? "admin-inline" : ""}`}
    >
      {children}
    </div>
  );
}
export function Grid({
  children,
}: {
  children: ReactNode;
  gridTemplateColumns?: string;
  gap?: string;
  alignItems?: string;
}) {
  return <div className="admin-search-grid">{children}</div>;
}
export function Paragraph({ children }: { children: ReactNode }) {
  return <p className="admin-copy">{children}</p>;
}
export function Button({
  variant,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string }) {
  return (
    <button
      className={`admin-button ${variant === "primary" ? "admin-primary" : ""}`}
      {...props}
    />
  );
}
export function TextField({
  label,
  details,
  value,
  ...props
}: {
  label: string;
  details?: string;
  value?: string;
  name: string;
  required?: boolean;
  maxLength?: number;
  placeholder?: string;
}) {
  const id = useId();
  return (
    <div className="admin-field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        defaultValue={value}
        aria-describedby={details ? `${id}-help` : undefined}
        {...props}
      />
      {details && (
        <span id={`${id}-help`} className="admin-field-help">
          {details}
        </span>
      )}
    </div>
  );
}
export function Select({
  label,
  value,
  children,
  name,
}: {
  label: string;
  value?: string;
  children: ReactNode;
  name: string;
}) {
  const id = useId();
  // A new loader result resets the initial selection without making the field read-only.
  return (
    <label className="admin-field" htmlFor={id}>
      {label}
      <select key={value} id={id} name={name} defaultValue={value}>
        {children}
      </select>
    </label>
  );
}
export function Option({
  value,
  children,
}: {
  value: string;
  children: ReactNode;
}) {
  return <option value={value}>{children}</option>;
}
export function AdminLink({
  href,
  children,
  target,
  slot,
}: {
  href: string;
  children: ReactNode;
  target?: "_blank";
  slot?: string;
}) {
  return target === "_blank" || !href.startsWith("/app") ? (
    <a
      className="admin-link"
      href={href}
      target={target}
      rel={target === "_blank" ? "noopener noreferrer" : undefined}
    >
      {children}
    </a>
  ) : (
    <Link
      className="admin-link"
      to={href}
      data-breadcrumb={slot ? true : undefined}
    >
      {children}
    </Link>
  );
}
export function Banner({
  tone,
  children,
}: {
  tone: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`admin-banner admin-${tone}`}
      role={tone === "critical" ? "alert" : "status"}
    >
      {children}
    </div>
  );
}
export function Badge({
  tone,
  children,
}: {
  tone: string;
  children: ReactNode;
}) {
  return <span className={`admin-badge admin-${tone}`}>{children}</span>;
}
export function List({ children }: { children: ReactNode }) {
  return <ul className="admin-list">{children}</ul>;
}
export function ListItem({ children }: { children: ReactNode }) {
  return <li>{children}</li>;
}
export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="table-scroll">
      <table>{children}</table>
    </div>
  );
}
export function TableHeaderRow({ children }: { children: ReactNode }) {
  return (
    <thead>
      <tr>{children}</tr>
    </thead>
  );
}
export function TableHeader({ children }: { children: ReactNode }) {
  return <th scope="col">{children}</th>;
}
export function TableBody({ children }: { children: ReactNode }) {
  return <tbody>{children}</tbody>;
}
export function TableRow({ children }: { children: ReactNode }) {
  return <tr>{children}</tr>;
}
export function TableCell({ children }: { children: ReactNode }) {
  return <td>{children}</td>;
}
