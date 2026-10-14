# Supabase email-code authentication

The application database remains PostgreSQL/Prisma. Supabase supplies verified email identities and authentication only; affiliate profiles, approvals, PayPal contact, assignments, and commission records stay in the app database.

Use a dedicated project for the Crafted affiliate portal. Sign in or create your Supabase account in the browser, and complete any account terms and project database-password entry yourself. The app does not need the Supabase database password or a service-role key.

## Dashboard configuration

1. Keep email sign-in and email confirmation enabled. Do not enable automatic confirmation or anonymous sign-in for this flow.
2. Set the authentication Site URL to the current HTTPS portal origin (`SHOPIFY_APP_URL` unless `PORTAL_URL` is set). Update this when a temporary tunnel changes.
3. Set the **Confirm signup** template subject to `Verify your Crafted affiliate email`, and paste `templates/confirm-signup.html` as its body.
4. Set the **Magic link** template subject to `Your Crafted affiliate sign-in code`, and paste `templates/magic-link.html` as its body. It contains `{{ .Token }}` so the email delivers a code; the portal does not use a magic-link callback.
5. For the initial test, the default mail service can send only to authorized project-team email addresses. Configure a verified SMTP sender before inviting real affiliates. Do not place SMTP passwords in source files or chat.
6. Put the project URL and its **publishable key** into `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` in the app's ignored server `.env`, then restart the app. The locally generated `PORTAL_SESSION_SECRET` is already present and is never committed.

The templates and configuration are prepared locally; they have not been applied to a Supabase project yet. Registration remains disabled until the managed provider is connected. Live email delivery and registration/approval testing still need verification.

References: [email OTP](https://supabase.com/docs/guides/auth/auth-email-passwordless), [templates](https://supabase.com/docs/guides/auth/auth-email-templates), [SMTP limits and configuration](https://supabase.com/docs/guides/auth/auth-smtp).
