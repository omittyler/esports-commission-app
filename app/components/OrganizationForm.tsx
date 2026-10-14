import { Form, useNavigation } from "react-router";

export function CreateOrganizationForm() {
  const navigation = useNavigation();
  return (
    <Form method="post">
      <s-stack gap="base">
        <s-text-field
          label="Organization name"
          name="name"
          required
          maxLength={200}
        />
        <s-text-field
          label="Slug"
          name="slug"
          required
          maxLength={80}
          details="Lowercase words separated by hyphens, for example team-alpha."
        />
        <s-text-field
          label="Commission percentage"
          name="percentage"
          value="20"
          required
          details="0–100, up to two decimal places. Applied to discounted merchandise only."
        />
        <s-button
          type="submit"
          variant="primary"
          disabled={navigation.state !== "idle"}
        >
          Create organization
        </s-button>
      </s-stack>
    </Form>
  );
}
