import { readFile, writeFile, mkdir } from "node:fs/promises";
import { Prisma } from "@prisma/client";
// Keep model names/fields shared with the rollback PostgreSQL application.
const input = await readFile(
  new URL("../prisma/schema.prisma", import.meta.url),
  "utf8",
);
const schema = input
  .replace(
    'provider = "prisma-client-js"',
    'provider = "prisma-client-js"\n  engineType = "client"\n  output = "../generated"',
  )
  .replace('provider = "postgresql"', 'provider = "sqlite"')
  .replace('env("DATABASE_URL")', '"file:local.db"')
  .replace(/ @db\.\w+(?:\([^)]*\))?/g, "")
  .replace(
    /cursorHistory\s+String\[\]\s+@default\(\[\]\)/,
    'cursorHistory Json @default("[]")',
  )
  .replace(/[\t ]+$/gm, "");
await mkdir(new URL("../cloudflare/prisma", import.meta.url), {
  recursive: true,
});
await writeFile(
  new URL("../cloudflare/prisma/schema.prisma", import.meta.url),
  schema,
);
const metadata = Prisma.dmmf.datamodel.models.map((model) => ({
  name: model.name,
  uniqueFields: model.uniqueFields,
  fields: model.fields.map((field) => {
    const result = Object.fromEntries(
      [
        "name",
        "kind",
        "type",
        "isRequired",
        "isId",
        "isUnique",
        "isList",
        "hasDefaultValue",
        "default",
        "isUpdatedAt",
        "relationName",
        "relationFromFields",
      ]
        .filter((k) => field[k] !== undefined)
        .map((k) => [k, field[k]]),
    );
    if (field.name === "cursorHistory")
      Object.assign(result, { type: "Json", isList: false, default: "[]" });
    return result;
  }),
}));
await writeFile(
  new URL("../cloudflare/model-metadata.json", import.meta.url),
  JSON.stringify(metadata, null, 2) + "\n",
);
