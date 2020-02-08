#!/usr/bin/env node

const { ArgumentParser } = require("argparse");
const { writeJson } = require("fs-extra");

require("pkginfo")(module);

const { generate } = require("../lib/apimtpl");

async function main() {
  const parser = new ArgumentParser({
    prog: module.exports.name,
    version: module.exports.version,
    addHelp: true,
    description: module.exports.description
  });

  parser.addArgument(["-f", "--force"], {
    action: "storeTrue",
    help: "Overwrite existing output files."
  });
  parser.addArgument(["--filenames"], {
    action: "storeTrue",
    help: "Print filenames when writing to stdout."
  });
  parser.addArgument(["-o"], {
    metavar: "<output>",
    defaultValue: "-",
    help: "Output directory where to write files."
  });
  parser.addArgument(["file"], {
    nargs: "+",
    metavar: "<file>",
    help: "Input files"
  });

  const args = parser.parseArgs();

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
