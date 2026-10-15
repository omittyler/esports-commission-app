import { useState } from "react";
import type { ActionFunctionArgs } from "react-router";
import {
  Form,
  data,
  redirect,
  useActionData,
  useLoaderData,
  useNavigation,
} from "react-router";
import {
  portalConfigured,
  sameOrigin,
  authClient,
  limitAuth,
  sessionStore,
} from "../services/affiliates/auth.server";
import { registrationProfile } from "../services/affiliates/profile";
import { PortalLayout } from "../components/PortalLayout";
export function loader() {
  return { configured: portalConfigured() };
}
export async function action({ request }: ActionFunctionArgs) {
  sameOrigin(request);
  if (!portalConfigured())
    return data(
      { error: "Registration is not open yet. Please contact Crafted." },
      { status: 503 },
    );
  try {
    const form = await request.formData();
    const profile = registrationProfile(form);
    await limitAuth("register", profile.email);
    const { error } = await authClient().auth.signInWithOtp({
      email: profile.email,
      options: { shouldCreateUser: true },
    });
    if (error)
      return data(
        {
          error:
            "We could not send your verification code. Please try again later.",
        },
        { status: 503 },
      );
    const store = sessionStore();
    const session = await store.getSession();
    session.set("challengeEmail", profile.email);
    session.set("challengeProfile", profile);
    return redirect("/portal/verify", {
      headers: { "Set-Cookie": await store.commitSession(session) },
    });
  } catch (error) {
    if (error instanceof Response) throw error;
    return data(
      { error: error instanceof Error ? error.message : "Unable to register" },
      { status: 400 },
    );
  }
}
export default function Register() {
  const [type, setType] = useState("organization");
  const { configured } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const busy = useNavigation().state !== "idle";
  return (
    <PortalLayout title="Join Crafted">
      <p>
        Register as an organization or creator. Verify your email, then wait for
        Crafted to approve your account.
      </p>
      {!configured && (
        <p className="notice">
          Registration opens soon. Please contact Crafted.
        </p>
      )}
      {result?.error && <p role="alert">{result.error}</p>}
      <Form method="post">
        <label>
          Affiliate type
          <select
            name="type"
            value={type}
            onChange={(e) => setType(e.target.value)}
          >
            <option value="organization">Organization</option>
            <option value="creator">Creator</option>
          </select>
        </label>
        <label>
          First name
          <input
            name="firstName"
            required
            maxLength={80}
            autoComplete="given-name"
          />
        </label>
        <label>
          Last name
          <input
            name="lastName"
            required
            maxLength={80}
            autoComplete="family-name"
          />
        </label>
        <label>
          Email
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            maxLength={254}
          />
        </label>
        {type === "organization" ? (
          <>
            <label>
              Organization name
              <input name="organizationName" required maxLength={200} />
            </label>
            <label>
              Role at organization
              <input name="organizationRole" required maxLength={100} />
            </label>
          </>
        ) : (
          <label>
            Creator name
            <input name="creatorName" required maxLength={200} />
          </label>
        )}
        <label>
          PayPal email
          <input name="paypalEmail" type="email" required maxLength={254} />
        </label>
        <p>
          Your PayPal email is used as payout contact information and is kept
          private.
        </p>
        <button type="submit" disabled={busy || !configured}>
          Register and verify email
        </button>
      </Form>
      <a href="/portal/login">Already registered? Sign in</a>
    </PortalLayout>
  );
}
