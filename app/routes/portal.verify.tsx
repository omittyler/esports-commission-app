import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  Form,
  data,
  redirect,
  useActionData,
  useNavigation,
} from "react-router";
import {
  sameOrigin,
  authClient,
  limitAuth,
  sessionStore,
  portalConfigured,
} from "../services/affiliates/auth.server";
import {
  bindVerifiedIdentity,
  registerVerifiedApplicant,
} from "../services/affiliates/admin.server";
import { registrationChallenge } from "../services/affiliates/profile";
import { PortalLayout } from "../components/PortalLayout";
export async function loader({ request }: LoaderFunctionArgs) {
  if (!portalConfigured()) throw redirect("/portal/login");
  if (
    !(await sessionStore().getSession(request.headers.get("Cookie"))).get(
      "challengeEmail",
    )
  )
    throw redirect("/portal/login");
  return null;
}
export async function action({ request }: ActionFunctionArgs) {
  sameOrigin(request);
  const store = sessionStore();
  const session = await store.getSession(request.headers.get("Cookie"));
  const email = session.get("challengeEmail");
  if (typeof email !== "string") throw redirect("/portal/login");
  const token = (await request.formData()).get("code");
  if (typeof token !== "string" || !/^\d{6,8}$/.test(token))
    return data({ error: "Enter the code from your email." }, { status: 400 });
  await limitAuth("verify", email);
  const { data: verified, error } = await authClient().auth.verifyOtp({
    email,
    token,
    type: "email",
  });
  if (error || !verified.session)
    return data({ error: "The code is invalid or expired." }, { status: 400 });
  const { data: identity, error: identityError } =
    await authClient().auth.getUser(verified.session.access_token);
  if (
    identityError ||
    !identity.user?.email_confirmed_at ||
    identity.user.email?.toLowerCase() !== email
  )
    return data({ error: "Email verification failed." }, { status: 403 });
  const profile = registrationChallenge(session.get("challengeProfile"));
  if (profile && profile.email !== email)
    return data({ error: "Registration identity mismatch." }, { status: 403 });
  if (profile) await registerVerifiedApplicant(profile, identity.user.id);
  else {
    try {
      await bindVerifiedIdentity(identity.user.id, email);
    } catch {
      return data(
        { error: "Finish registration before signing in." },
        { status: 403 },
      );
    }
  }
  const fresh = await store.getSession();
  fresh.set("accessToken", verified.session.access_token);
  return redirect("/portal/status", {
    headers: { "Set-Cookie": await store.commitSession(fresh) },
  });
}
export default function Verify() {
  const result = useActionData<typeof action>();
  const busy = useNavigation().state !== "idle";
  return (
    <PortalLayout title="Verify your email">
      <p>If your email is registered, a code has been sent. Enter it below.</p>
      {result?.error && <p role="alert">{result.error}</p>}
      <Form method="post">
        <label>
          Email code
          <input
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            pattern="[0-9]{6,8}"
            maxLength={8}
          />
        </label>
        <button type="submit" disabled={busy}>
          Verify and continue
        </button>
      </Form>
      <a href="/portal/login">Request another code</a>
    </PortalLayout>
  );
}
