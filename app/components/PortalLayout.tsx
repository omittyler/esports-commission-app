import type { ReactNode } from "react";
import { Form, Link } from "react-router";
import "../styles/portal.css";

export function PortalIcon({
  name,
}: {
  name: "dashboard" | "collection" | "arrow";
}) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {name === "dashboard" ? (
        <>
          <rect x="3" y="3" width="7" height="7" rx="1.5" />
          <rect x="14" y="3" width="7" height="7" rx="1.5" />
          <rect x="3" y="14" width="7" height="7" rx="1.5" />
          <rect x="14" y="14" width="7" height="7" rx="1.5" />
        </>
      ) : name === "collection" ? (
        <>
          <path d="M3 7h7l2 2h9v11H3z" />
          <path d="M3 7V4h7l2 2h8v3" />
        </>
      ) : (
        <>
          <path d="M6 18 18 6M6 6h12v12" />
        </>
      )}
    </svg>
  );
}

export function PortalEmptyState({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <PortalIcon name="collection" />
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}

export function PortalLayout({
  title,
  description,
  partnerName,
  activePage,
  children,
}: {
  title: string;
  description?: string;
  partnerName?: string;
  activePage?: "dashboard" | "products";
  children: ReactNode;
}) {
  return (
    <div
      className={`partner-portal ${partnerName ? "portal-shell" : "portal-auth"}`}
    >
      {partnerName && (
        <aside className="portal-sidebar">
          <Link className="portal-brand" to="/portal/dashboard">
            <span className="brand-mark">C</span>
            <span>
              CRAFTED<small>PARTNER PORTAL</small>
            </span>
          </Link>
          <div className="partner-identity">
            <span className="partner-avatar">{partnerName.slice(0, 1)}</span>
            <div>
              <strong>{partnerName}</strong>
              <span>Affiliate account</span>
            </div>
          </div>
          <div className="nav-caption">WORKSPACE</div>
          <nav aria-label="Partner navigation">
            <Link
              to="/portal/dashboard"
              className={activePage === "dashboard" ? "active" : ""}
              aria-current={activePage === "dashboard" ? "page" : undefined}
            >
              <PortalIcon name="dashboard" />
              Dashboard
            </Link>
            <Link
              to="/portal/products"
              className={activePage === "products" ? "active" : ""}
              aria-current={activePage === "products" ? "page" : undefined}
            >
              <PortalIcon name="collection" />
              Collections
            </Link>
          </nav>
          <div className="sidebar-footer">
            <p>
              Your partnership.
              <br />
              Your performance.
            </p>
            <Form method="post" action="/portal/logout">
              <button className="sign-out" type="submit">
                Sign out <span aria-hidden="true">→</span>
              </button>
            </Form>
          </div>
        </aside>
      )}
      <main className="portal-main">
        <header className="portal-page-header">
          <div>
            <p className="eyebrow">
              {partnerName
                ? `${partnerName} · CRAFTED PARTNERS`
                : "CRAFTED · AFFILIATE PORTAL"}
            </p>
            <h1>{title}</h1>
            {description && <p className="page-description">{description}</p>}
          </div>
          {partnerName && (
            <span className="account-badge">
              <span />
              Approved partner
            </span>
          )}
        </header>
        {children}
        {partnerName && (
          <footer className="portal-footer">
            Crafted affiliate portal <span>Built for your team.</span>
          </footer>
        )}
      </main>
    </div>
  );
}
