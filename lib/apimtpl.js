const { resolve } = require("path");

const { readJson } = require("fs-extra");
const Ajv = require("ajv");

const { readYaml, merge, walk, clone } = require("./utils");
const { createTemplate } = require("./arm");

const schemaPath = resolve(__dirname, "../config-schema.json");

async function generate(paths) {
  const input = await combine(paths)
    .then(validateInput)
    .then(expand)
    .then(validateExpanded);
  return createTemplate(input);
}

async function combine(paths) {
  const files = (await findFiles(paths))
    .flat()
    .filter((value, idx, arr) => arr.indexOf(value) === idx);

  const objs = (await Promise.all(files.map(readYaml))).flat();

  const result = {};

  for (const obj of objs) {
    merge(result, obj);
  }

  return result;
}

async function validateInput(input) {
  const schema = await readJson(schemaPath);

  const ajv = new Ajv({ useDefaults: true });
  const valid = ajv.validate(schema, input);

  if (!valid) {
    throw new Error(
      (ajv.errors || ["unknown validation error"])
        .map(err => (err.dataPath ? `${err.dataPath}: ` : "") + err.message)
        .join("; ")
    );
  }

  return input;
}

function expand(input) {
  function replace(str, obj, environment, api) {
    return str.replace(/\$\{([^}]+)\}/g, (str, key) => {
      if (key === "environment.name") {
        return environment.name;
      } else if (key === "api.name") {
        return api.name;
      } else if (key === "name") {
        return obj.name;
      } else {
        throw new Error(`could not resolve placeholder: ${str}`);
      }
    });
  }

  const environments = clone(input.environments);

  for (const environment of environments) {
    environment.apis = merge(clone(input.apis), environment.apis);
    environment.products = merge(clone(input.products), environment.products);
    environment.subscriptions = merge(
      clone(input.subscriptions),
      environment.subscriptions
    );

    for (const api of environment.apis) {
      api.path = replace(api.path, api, environment, api);

      for (const [key, val] of Object.entries(api.policies)) {
        api.policies[key] = replace(val, api, environment, api);
      }

      for (const operation of api.operations) {
        operation.path = replace(operation.path, operation, environment, api);

        for (const [key, val] of Object.entries(operation.policies)) {
          operation.policies[key] = replace(val, operation, environment, api);
        }
      }
    }

    for (const sub of environment.subscriptions) {
      sub.scope.product = replace(sub.scope.product, sub, environment);
    }
  }

  return { environments };
}

function validateExpanded(input) {
  const errors = [];

  for (const environment of input.environments) {
    for (const product of environment.products) {
      for (const ref of product.apis) {
        const existing = environment.apis.find(api => api.name === ref);
        if (existing == null) {
          errors.push(`product ${product.name}: api ${ref} not found!`);
        }
      }
    }

    for (const subscription of environment.subscriptions) {
      const ref = subscription.scope.product;
      const existing = environment.products.find(
        product => product.name === ref
      );
      if (existing == null) {
        errors.push(
          `subscription ${subscription.name}: product ${ref} not found!`
        );
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(errors.join("; "));
  }

  return input;
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

module.exports = { generate };
