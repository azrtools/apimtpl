#!/usr/bin/env node

const { ArgumentParser } = require("argparse");

require("pkginfo")(module);

const { generate } = require("../lib/apimtpl");

async function main() {
  const parser = new ArgumentParser({
    prog: module.exports.name,
    version: module.exports.version,
    addHelp: true,
    description: module.exports.description
  });
  parser.addArgument(["file"], {
    nargs: "+",
    metavar: "<file>",
    help: "Input files"
  });

  const args = parser.parseArgs();

  const result = await generate(args.file);
  console.log(JSON.stringify(result, null, "  "));
}

if (require.main === module) {
  main().catch(err => {
    process.exitCode = 1;
    console.error(err);
  });
}
