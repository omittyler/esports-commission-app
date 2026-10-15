import * as UI from "./AdminUI";
import { Form, useNavigation } from "react-router";

export function CreateOrganizationForm() {
  const navigation = useNavigation();
  return (
    <Form method="post">
      <UI.Stack gap="base">
        <UI.TextField
          label="Organization name"
          name="name"
          required
          maxLength={200}
        />
        <UI.TextField
          label="Slug"
          name="slug"
          required
          maxLength={80}
          details="Lowercase words separated by hyphens, for example team-alpha."
        />
        <UI.TextField
          label="Commission percentage"
          name="percentage"
          value="20"
          required
          details="0–100, up to two decimal places. Applied to discounted merchandise only."
        />
        <UI.Button
          type="submit"
          variant="primary"
          disabled={navigation.state !== "idle"}
        >
          Create organization
        </UI.Button>
      </UI.Stack>
    </Form>
  );
}
