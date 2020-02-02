const { join, resolve } = require("path");

const { readdir, stat, readFile, readJson } = require("fs-extra");
const { safeLoadAll } = require("js-yaml");
const Ajv = require("ajv");

const { createTemplate } = require("./arm");

const schemaPath = resolve(__dirname, "../config-schema.json");

async function generate(paths) {
  const combined = await combine(paths);
  const validated = await validate(combined);
  return createTemplate(validated);
}

async function combine(paths) {
  const files = (await findFiles(paths))
    .flat()
    .filter((value, idx, arr) => arr.indexOf(value) === idx);

  const objs = (await Promise.all(files.map(readYaml))).flat();

  const result = {
    apis: [],
    environments: []
  };

  for (const obj of objs) {
    merge(result, obj);
  }

  return result;
}

async function validate(input) {
  const schema = await readJson(schemaPath);

  const ajv = new Ajv({ useDefaults: true });
  const valid = ajv.validate(schema, input);

  const errors = (ajv.errors || []).map(
    err => (err.dataPath ? `${err.dataPath}: ` : "") + err.message
  );

  if (valid) {
    for (const product of input.products) {
      for (const ref of product.apis) {
        const existing = input.apis.find(api => api.name === ref);
        if (existing == null) {
          errors.push(`product ${product.name}: api ${ref} not found!`);
        }
      }
    }

    for (const subscription of input.subscriptions) {
      const ref = subscription.scope.product;
      const existing = input.products.find(product => product.name === ref);
      if (existing == null) {
        errors.push(
          `subscription ${subscription.name}: product ${ref} not found!`
        );
      }
    }
  } else if (errors.length === 0) {
    errors.push("unknown validation error");
  }

  if (errors.length > 0) {
    throw new Error(errors.join("; "));
  }

  return input;
}

function merge(target, source) {
  if (Array.isArray(target) && Array.isArray(source)) {
    for (const obj of source) {
      const existing = target.find(item => item.name === obj.name);
      if (existing) {
        merge(existing, obj);
      } else {
        target.push(obj);
      }
    }
  } else if (isObject(target) && isObject(source)) {
    for (const [key, val] of Object.entries(source)) {
      const t = target[key];
      if (Array.isArray(t) || isObject(t)) {
        merge(t, val);
      } else {
        target[key] = val;
      }
    }
  } else {
    throw new Error("cannot merge: " + target + " <- " + source);
  }
}

function isObject(obj) {
  return Object.prototype.toString.call(obj) === "[object Object]";
}

async function readYaml(path) {
  const content = await readFile(path, "utf8");
  return safeLoadAll(content);
}

function findFiles(paths) {
  return Promise.all(
    paths.map(path =>
      walk(resolve(path), (p, dir) =>
        dir
          ? !p.endsWith("node_modules") && !p.endsWith("/.git")
          : p.endsWith(".yml") || p.endsWith(".yaml")
      )
    )
  );
}

async function walk(path, filter, dir = null) {
  if (dir == null) {
    const stats = await stat(path);
    dir = stats.isDirectory();
  }
  if (dir) {
    if (!filter(path, true)) {
      return [];
    }
    const entries = await readdir(path, { withFileTypes: true });
    return Promise.all(
      entries.map(entry => {
        const p = join(path, entry.name);
        const dir = entry.isDirectory();
        return filter(p, dir) ? (dir ? walk(p, filter, true) : [p]) : [];
      })
    ).then(arr => arr.flat());
  } else {
    return [path].filter(p => filter(p, false));
  }
}

module.exports = { generate };
