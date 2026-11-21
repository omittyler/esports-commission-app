-- Run as the database owner after a restore made with --no-owner --no-acl.
SELECT format('GRANT CONNECT ON DATABASE %I TO commission_app', current_database()) \gexec
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO commission_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO commission_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO commission_app;
ALTER DEFAULT PRIVILEGES FOR ROLE commission_admin IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO commission_app;
ALTER DEFAULT PRIVILEGES FOR ROLE commission_admin IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO commission_app;
