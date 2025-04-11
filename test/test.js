import { readdirSync } from "fs";
import { readFile } from "fs/promises";

import { describe, it } from "mocha";
import { expect } from "chai";

import { generate } from "../lib/apimtpl.js";

const INPUT_SUFFIX = "-input.yaml";
const FAIL_SUFFIX = "-fail.yaml";

describe("apimtpl", () => {
  const files = readdirSync("test");
  for (const file of files) {
    if (file.endsWith(INPUT_SUFFIX)) {
      const base = file.substr(0, file.length - INPUT_SUFFIX.length);
      it(`should generate the expected output (${base})`, async () => {
        const result = await generate([`test/${file}`]);
        const output =
          Object.keys(result).length === 1
            ? JSON.stringify(Object.entries(result)[0][1], null, 2)
            : JSON.stringify(result, null, 2);
        const expected = JSON.parse(
          await readFile(`test/${base}-output.json`, "utf8")
        );
        return expect(output).equals(JSON.stringify(expected, null, 2));
      });
    } else if (file.endsWith(FAIL_SUFFIX)) {
      const base = file.substr(0, file.length - FAIL_SUFFIX.length);
      it(`should fail with the expected output (${base})`, async () => {
        let error = null;
        try {
          await generate([`test/${file}`]);
        } catch (e) {
          error = e;
        }
        if (error == null) {
          throw new Error("No error thrown!");
        }
        const expected = await readFile(`test/${base}-output.txt`, "utf8");
        return expect(error.message).equals(expected.trim());
      });
    }
  }
});
