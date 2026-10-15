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
import { emailAddress } from "../services/affiliates/profile";
import { PortalLayout } from "../components/PortalLayout";
export function loader() {
  return { configured: portalConfigured() };
}
export async function action({ request }: ActionFunctionArgs) {
  sameOrigin(request);
  if (!portalConfigured())
    return data(
      { error: "Sign-in is not open yet. Please contact Crafted." },
      { status: 503 },
    );
  try {
    const email = emailAddress((await request.formData()).get("email"));
    await limitAuth("login", email);
    const { error } = await authClient().auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false },
    });
    // Never disclose whether an email has an account.
    if (error) {
      /* Provider errors are intentionally not exposed. */
    }
    const store = sessionStore();
    const session = await store.getSession();
    session.set("challengeEmail", email);
    return redirect("/portal/verify", {
      headers: { "Set-Cookie": await store.commitSession(session) },
    });
  } catch (error) {
    if (error instanceof Response) throw error;
    return data(
      { error: "Unable to request sign-in. Check the email and try again." },
      { status: 400 },
    );
  }
}
export default function Login() {
  const { configured } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const busy = useNavigation().state !== "idle";
  return (
    <PortalLayout title="Affiliate sign-in">
      <p>We’ll email you a verification code.</p>
      {!configured && (
        <p className="notice">Sign-in opens soon. Please contact Crafted.</p>
      )}
      {result?.error && <p role="alert">{result.error}</p>}
      <Form method="post">
        <label>
          Email
          <input type="email" name="email" required autoComplete="email" />
        </label>
        <button type="submit" disabled={busy || !configured}>
          Send sign-in code
        </button>
      </Form>
      <a href="/portal/register">Register an organization or creator</a>
    </PortalLayout>
  );
}
