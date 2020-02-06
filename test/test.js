const { readdirSync, readJson } = require("fs-extra");
const { describe, it } = require("mocha");
const { expect } = require("chai");

const { generate } = require("../lib/apimtpl");

const SUFFIX = "-input.yaml";

describe("apimtpl", () => {
  const files = readdirSync("test");
  for (const file of files) {
    if (file.endsWith(SUFFIX)) {
      const base = file.substr(0, file.length - SUFFIX.length);
      it(`should generate the expected output (${base})`, async () => {
        const result = await generate([`test/${file}`]);
        const output = JSON.stringify(result, null, 2);
        const expected = await readJson(`test/${base}-output.json`);
        return expect(output).equals(JSON.stringify(expected, null, 2));
      });
    }
  }
});
