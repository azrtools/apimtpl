#!/usr/bin/env node

const { ArgumentParser } = require("argparse");
const { writeJson } = require("fs-extra");

require("pkginfo")(module);

const { generate } = require("../lib/apimtpl");

async function main() {
  const parser = new ArgumentParser({
    prog: module.exports.name,
    add_help: true,
    description: module.exports.description
  });

  parser.add_argument("-v", "--version", {
    action: "version",
    version: module.exports.version,
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
      await writeJson(`${args.o}/${name}`, obj, options);
    }
  }
}

if (require.main === module) {
  main().catch(err => {
    process.exitCode = 1;
    console.error(err);
  });
}
