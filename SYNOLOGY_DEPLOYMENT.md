# Synology staging and go-live

This is a portable deployment setup, not a completed NAS installation. Confirm the DiskStation model, CPU architecture, RAM, DSM version, and Container Manager support before deploying. The current GitHub container job tests Linux amd64. An ARM NAS needs its own matching image and runtime check.

The latest verified source/image includes automatic catch-up: commit `bc1ea7eacc0ce0e4af7c49130e1f93481934f5cc`, [CI run 38663540660](https://github.com/omittyler/esports-commission-app/actions/runs/38663540660), artifact `synology-app-amd64-bc1ea7eacc0ce0e4af7c49130e1f93481934f5cc`. After loading its archive, set `APP_IMAGE_TAG=sha-bc1ea7eacc0ce0e4af7c49130e1f93481934f5cc`. Both source and container jobs passed. The working database now has 18 tables, all matched in an exported-snapshot backup/restore rehearsal. Earlier release archives below predate catch-up; use this image and a fresh final backup for transfer.

That image and its checksum are saved in ignored `.cache/synology-release-bc1ea7e/`; the downloaded archive's SHA-256 matches the exported checksum. Copy this verified release package privately when preparing a compatible NAS.

## What moves

`compose.synology.yaml` defines the app, a one-time migration service, PostgreSQL 18 with a persistent volume, and optional commission-worker and public-tunnel profiles. The app runs as a non-root container user. Its database role can read/write application tables but cannot own tables, run DDL, create databases/roles, or disable financial guards. Only the migration service receives the database-owner connection.

The source database is PostgreSQL 18. Transfer it with PostgreSQL 18 client utilities and a custom-format dump; do not copy Windows database files into a Linux container or restore this dump into the older PostgreSQL 17 development Compose service.

The `processing` and `public` profiles are intentionally separate from initial staging. The database port is never published. The app's optional local port binds only to loopback; the tunnel reaches `http://app:3000` over the container network. PostgreSQL 18 persists at `/var/lib/postgresql`, not the older `/var/lib/postgresql/data` mount.

## Checks before go-live

- Run unit, database, lint, type, and production-build checks.
- GitHub CI builds the Docker image and runs the actual app with a disposable PostgreSQL 18 database and fictional credentials. It verifies the portal landing/login page, database health, runtime privileges, exact sale/refund rounding, duplicate replay protection, immutable ledger, backup restoration, one-shot worker exit, and data survival after restart.
- The container job exports an amd64 image archive and SHA-256 checksum only after its rehearsal passes. Download the `synology-app-amd64-<commit>` artifact from the successful CI run. Artifacts expire after seven days; keep a private copy of the verified release image.
- The real local database backup has also been restored to a separate disposable local database. Source manifest and dump share an exported PostgreSQL snapshot, so concurrent source activity cannot make their contents disagree. All 14 public tables and financial schema definitions matched in the rehearsal. The rehearsal database was removed; the private archive and manifests remain in ignored `.cache`.
- After shared payment tracking was added, another exported-snapshot backup/restore rehearsal matched all 17 public tables and financial schema definitions, including payments, allocations and void corrections. Use a fresh backup and an image containing migration 20261014000400_payment_tracking; the earlier local 58065fb image predates this functionality.
- The payment milestone's tested amd64 image is exported from [CI run 38660124137](https://github.com/omittyler/esports-commission-app/actions/runs/38660124137), source commit `0f9028b85052643cf3392e46436272e309444c3e`. Both verification and container jobs passed, including payment records/corrections after restore and restart. Download its image/checksum before transfer; GitHub artifact retention is seven days.
- Real managed email verification and the Organization approval gate have been tested. An independent Creator account and a real qualifying assigned sale/refund still need end-to-end verification before launch. Financial integration/container fixtures do not claim a real Shopify checkout test.
- Run a staging startup/restart and backup-restore check on the actual NAS before using it as the live writer.

## Staging setup

Use a private folder on the NAS, such as `/volume1/docker/esports-commission-app`. Copy the reviewed repository/release files there, with the image archive separately. Put real credentials in a private `.env.synology`, using `deploy/synology.env.example` as the checklist. Generate different random hexadecimal passwords for the database owner and application role. Keep the existing Shopify registration, shop, currency, Supabase project, and session secret. Never commit real credentials, backups, or manifests.

For a staged image import, use Container Manager's image import or:

```sh
sha256sum -c image.sha256
docker load -i esports-commission-app-amd64.tar
```

Set `APP_IMAGE_TAG=sha-<verified-commit>` in `.env.synology` to select that exact image. Verify the archive checksum before importing it. In Container Manager, use the Project feature with `compose.synology.yaml`; validate that the installed Compose implementation supports dependency health/completion conditions and the selected profiles. CLI equivalents below assume the project folder is the current directory:

```sh
docker compose --env-file .env.synology -f compose.synology.yaml config --quiet
docker compose --env-file .env.synology -f compose.synology.yaml up -d postgres
```

The first database startup creates `commission_admin`, the restricted `commission_app` role, and its default permissions. Initialization scripts only run for an empty database volume. Changing password variables later does not rotate an existing database user's password.

### Restore into the new empty database

Keep app, migration, and worker services stopped until the restore is complete. Put the private custom-format dump at `backups/commission-final.dump`, inside the project's private backup folder. Restore the whole database, including Prisma migration history, accounts, Shopify sessions, assignments, immutable program/rate versions, audits, ledger, and webhook inbox:

```sh
docker compose --env-file .env.synology -f compose.synology.yaml exec -T postgres pg_restore -U commission_admin -d commission --exit-on-error --single-transaction --no-owner --no-acl /backups/commission-final.dump
docker compose --env-file .env.synology -f compose.synology.yaml exec -T postgres psql -q -v ON_ERROR_STOP=1 -U commission_admin -d commission -f /docker-entrypoint-initdb.d/30-grants.sql
docker compose --env-file .env.synology -f compose.synology.yaml up -d --no-build app
```

These restore commands target an **empty destination**. They do not clear or overwrite an existing database. If the destination has app tables already, stop and use a separate fresh destination. Never seed the restored working database. Never use `down --volumes` on a working installation.

### Compare restored data

Generate the source manifest during the final write freeze using the same code release and source database. On the restored app:

```sh
docker compose --env-file .env.synology -f compose.synology.yaml exec -T app node --import tsx scripts/database-manifest.ts /tmp/restored-manifest.json
docker compose --env-file .env.synology -f compose.synology.yaml cp app:/tmp/restored-manifest.json backups/restored-manifest.json
```

Compare with `node scripts/compare-manifests.mjs backups/source-manifest.json backups/restored-manifest.json`, on a machine with Node installed, or copy the source manifest into `/tmp` in the app container and run the same comparison there. The comparison checks table sets, row counts, every raw row value, and columns, enum labels, indexes, constraints, triggers, and application functions. Monetary bigint values never pass through JavaScript floating-point conversion. The manifest contains hashes and counts, not contact details or session-token contents.

The manifest intentionally does not reproduce owner/ACL differences across hosts. Reapply the restricted role grants separately and verify those privileges. Large databases may require a longer manifest timeout or a streaming audit; this version reads tables into memory and has a two-minute snapshot transaction budget.

## Public address and final cutover

1. Keep the working PC setup until NAS staging and restore checks pass. For the final snapshot, pause administrative/registration writes and stop the local worker and app; take a fresh consistent backup. Run only one writable production database after cutover.
2. Configure a stable HTTPS route for `portal.crafted.gg`. A named Cloudflare Tunnel can forward to `http://app:3000`. Its domain/DNS prerequisites need review: the free setup generally requires the zone on Cloudflare DNS, while GoDaddy can remain the registrar. Preserve and verify every storefront, mailbox, and Resend sending record before any nameserver change. A GoDaddy-only DNS/reverse-proxy route is a separate option to review. No DNS or router settings have been changed by this preparation.
3. Keep credentials out of shell history. Enter the named tunnel token privately in `.env.synology` and enable the `public` profile after approval of the concrete public-hostname configuration.
4. Set both origins to `https://portal.crafted.gg`, update Supabase's Site URL, and prepare/validate/publish Shopify's matching application/callback URL while preserving scopes and webhook topics. This remains a separate live activation step. Partners sign in again on the new hostname because their cookies are bound to the previous host.
5. Verify admin authentication, offline Shopify access, real email login, approval denial/access, collection links, and partner-isolated reports. Start the worker after the restored state is verified, or run the complete scheduled refresh. Confirm catch-up discovered the accessible cutover interval and reconciliation has no unexplained pending failures. Review any older coverage-gap warning; webhook replay and the bounded recent-order scan do not certify inaccessible history. See [ORDER_CATCHUP.md](ORDER_CATCHUP.md).
6. Verify a real qualifying assigned sale and its refund before declaring launch complete. Check that posted commissions and reversals agree exactly and that duplicate events do not add entries.

To enable normal processing after validation:

```sh
docker compose --env-file .env.synology -f compose.synology.yaml --profile processing up -d --no-build worker
```

For a configured and approved tunnel:

```sh
docker compose --env-file .env.synology -f compose.synology.yaml --profile public up -d --no-build tunnel
```

## Operation and backups

Container restart policies recover service processes after a NAS restart. Schedule database-aware backups using `pg_dump -Fc`, retain multiple copies, protect them with encryption and access controls, and keep a recovery copy away from the NAS. A RAID array or a volume snapshot by itself is not a rehearsed database recovery plan. Backup archives contain private contacts and Shopify tokens; do not upload them to GitHub or public artifact storage. Rehearse restoration into a separate database periodically.

A NAS, power, or home-internet outage interrupts portal access. The durable inbox, transactional ledger, idempotency and retry leases remain in PostgreSQL. Automatic catch-up resumes within current recent-order access; coverage gaps and financial failures remain visible for review. Complete daily-only refresh is supported through the command in ORDER_CATCHUP.md, but the actual DSM schedule is not configured yet.

Sources: [Synology Container Manager](https://www.synology.com/en-global/dsm/packages/ContainerManager), [Compose startup dependencies](https://docs.docker.com/compose/how-tos/startup-order), [PostgreSQL 18 image storage](https://docs.docker.com/guides/postgresql/immediate-setup-and-data-persistence/), [pg_dump](https://www.postgresql.org/docs/18/app-pgdump.html), [pg_restore](https://www.postgresql.org/docs/18/app-pgrestore.html), [Shopify hosting](https://shopify.dev/docs/apps/launch/deployment/deploy-to-hosting-service).
