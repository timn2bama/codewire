import { readdirSync } from "node:fs";

const offenders = readdirSync(new URL("../api/", import.meta.url), {
  recursive: true,
})
  .filter((file) => /\.(?:test|spec)\./i.test(file))
  .map((file) => `api/${file.replaceAll("\\", "/")}`)
  .sort();

if (offenders.length > 0) {
  console.error(
    [
      "Deployable api/ contains test/spec files:",
      ...offenders.map((file) => `- ${file}`),
    ].join("\n"),
  );
  process.exit(1);
}
