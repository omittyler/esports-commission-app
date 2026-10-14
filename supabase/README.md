# Supabase email-code authentication

The application database remains PostgreSQL/Prisma. Supabase supplies verified email identities and authentication only; affiliate profiles, approvals, PayPal contact, assignments, and commission records stay in the app database.

Use a dedicated project for the Crafted affiliate portal. Sign in or create your Supabase account in the browser, and complete any account terms and project database-password entry yourself. The app does not need the Supabase database password or a service-role key.

## Dashboard configuration

1. Keep email sign-in and email confirmation enabled. Do not enable automatic confirmation or anonymous sign-in for this flow.
2. Set the authentication Site URL to the current HTTPS portal origin (`SHOPIFY_APP_URL` unless `PORTAL_URL` is set). Update this when a temporary tunnel changes.
3. Set the **Confirm signup** template subject to `Verify your Crafted affiliate email`, and paste `templates/confirm-signup.html` as its body.
4. Set the **Magic link** template subject to `Your Crafted affiliate sign-in code`, and paste `templates/magic-link.html` as its body. It contains `{{ .Token }}` so the email delivers a code; the portal does not use a magic-link callback.
5. Configure a verified SMTP sender before editing the templates or inviting applicants. The selected Free project requires custom SMTP to edit email templates. Resend Free has been selected, using the proposed sending subdomain `auth.crafted.gg`. Its SMTP host is `smtp.resend.com`, port `465`, username `resend`, and password a Resend API key. Use `Crafted Affiliates` as the sender name and `no-reply@auth.crafted.gg` after verifying the domain. Enter the SMTP password directly in Supabase; do not place it in source files or chat.
6. Put the project URL and its **publishable key** into `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` in the app's ignored server `.env`, then restart the app. The locally generated `PORTAL_SESSION_SECRET` is already present and is never committed.

The existing `esports-commission-app` Supabase project has been selected. Email sign-in and confirmation are enabled, and its Site URL has been set to the current HTTPS test tunnel. The code templates are prepared locally but have not been applied. The Resend account is ready. With owner approval, GoDaddy saved the three account-generated outbound-email DNS records for `auth.crafted.gg`; public DNS resolves them and Resend confirms the domain is verified. Supabase's sender/host/username fields and a domain-restricted sending-key form are prepared. The owner must complete credential creation and enter/save the SMTP password directly in Supabase. Registration remains disabled until SMTP and code templates are ready; live email delivery and registration/approval testing still need verification.

References: [email OTP](https://supabase.com/docs/guides/auth/auth-email-passwordless), [templates](https://supabase.com/docs/guides/auth/auth-email-templates), [SMTP limits and configuration](https://supabase.com/docs/guides/auth/auth-smtp).

Resend reference: [Supabase SMTP setup](https://resend.com/docs/send-with-supabase-smtp).
