import type { ReactNode } from "react";
export function PortalLayout({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="partner-portal">
      <style>{`body:has(.partner-portal){margin:0;background:#f3f5f8;color:#17202a;font-family:Inter,system-ui,sans-serif}.partner-portal{max-width:1100px;margin:40px auto;padding:32px;background:white;border-radius:16px;box-shadow:0 4px 30px #13223812}.partner-portal h1{margin-top:12px}.partner-portal header{color:#526177;font-weight:700;letter-spacing:.1em}.partner-portal form{max-width:540px;display:grid;gap:16px;margin:24px 0}.partner-portal label{display:grid;gap:7px;font-weight:600}.partner-portal input,.partner-portal select{padding:12px;border:1px solid #c9d2de;border-radius:8px;font:inherit}.partner-portal button{border:0;border-radius:8px;background:#162c47;color:white;padding:12px 20px;font:inherit;cursor:pointer}.partner-portal button:disabled{opacity:.5;cursor:default}.partner-portal a{color:#244c7a}.partner-portal .notice{padding:16px;background:#fef2cf;border-radius:8px}.partner-portal [role=alert]{color:#a12222}.partner-portal table{width:100%;border-collapse:collapse;margin:20px 0}.partner-portal th,.partner-portal td{padding:12px;text-align:left;border-bottom:1px solid #e4e8ee}.partner-portal .metrics{display:flex;gap:16px;flex-wrap:wrap}.partner-portal .metric{padding:20px;background:#f3f5f8;border-radius:12px;min-width:180px}@media(max-width:700px){.partner-portal{margin:0;padding:20px;border-radius:0}.partner-portal table{display:block;overflow:auto}}`}</style>
      <header>CRAFTED · AFFILIATE PORTAL</header>
      <h1>{title}</h1>
      {children}
    </div>
  );
}
