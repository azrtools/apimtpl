#!/usr/bin/env node

import process from "process";
import { readFile, writeFile } from "fs/promises";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

import { ArgumentParser } from "argparse";

import { generate } from "../lib/apimtpl.js";

async function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const pkg = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));

  const parser = new ArgumentParser({
    prog: pkg.name,
    add_help: true,
    description: pkg.description
  });

  parser.add_argument("-v", "--version", {
    action: "version",
    version: pkg.version,
    help: "show version number and exit"
  });
  parser.add_argument("-f", "--force", {
    action: "store_true",
    help: "overwrite existing output files."
  });
  parser.add_argument("--filenames", {
    action: "store_true",
    help: "print filenames when writing to stdout."
  });
  parser.add_argument("-o", {
    metavar: "<output>",
    default: "-",
    help: "output directory where to write files."
  });
  parser.add_argument("file", {
    nargs: "+",
    metavar: "<file>",
    help: "input files"
  });

  const args = parser.parse_args();

  const output = await generate(args.file);

  if (args.o === "-") {
    if (args.filenames) {
      console.log(JSON.stringify(output, null, "  "));
    } else {
      for (const obj of Object.values(output)) {
        console.log(JSON.stringify(obj, null, "  "));
      }
    }
  } else {
    const options = { spaces: 2, flag: args.force ? "w" : "wx" };
    for (const [name, obj] of Object.entries(output)) {
      await writeFile(`${args.o}/${name}`, JSON.stringify(obj), options);
    }
  }
}

main().catch(err => {
  process.exitCode = 1;
  console.error(err);
});
