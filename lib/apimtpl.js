const { resolve } = require("path");

const { readJson } = require("fs-extra");
const Ajv = require("ajv");

const { readYaml, merge, walk, clone, toTitleCase } = require("./utils");
const { generateOutput } = require("./arm");

const schemaPath = resolve(__dirname, "../config-schema.json");

async function generate(paths) {
  const input = await combine(paths)
    .then(validateInput)
    .then(cloneInput)
    .then(expandNames)
    .then(expandPlaceholders)
    .then(validateExpanded);
  return generateOutput(input);
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

function cloneInput(input) {
  const environments = clone(input.environments);

  for (const environment of environments) {
    for (const key of [
      "configuration",
      "variables",
      "apis",
      "products",
      "subscriptions"
    ]) {
      if (input[key] != null) {
        environment[key] = merge(clone(input[key]), environment[key]);
      }
    }
  }

  return { parameters: input.parameters, environments };
}

function expandNames(input) {
  function displayName(obj) {
    return obj.displayName || toTitleCase(obj.name, false);
  }

  function fullName(...objs) {
    return objs.map(obj => obj.name).join("-");
  }

  function fullDisplayName(...objs) {
    return objs.map(obj => obj.displayName).join(" - ");
  }

  function fullPropertyDisplayName(...objs) {
    return objs
      .map(obj => toTitleCase(obj.displayName || obj.name))
      .map(str => str.replace(/[^A-Za-z0-9]/g, ""))
      .join("-");
  }

  const { environments } = input;

  for (const environment of environments) {
    environment.displayName = displayName(environment);

    for (const api of environment.apis) {
      api.displayName = displayName(api);
      api.fullName = fullName(api, environment);
      api.fullDisplayName = fullDisplayName(api, environment);

      for (const property of api.properties) {
        const scope = { name: "default" };
        property.displayName = displayName(property);
        property.fullName = fullName(api, environment, scope, property);
        property.fullDisplayName = fullPropertyDisplayName(
          api,
          environment,
          scope,
          property
        );
      }

      for (const operation of api.operations) {
        operation.displayName = displayName(operation);
        operation.fullName = `${api.fullName}/${operation.name}`;
        operation.fullDisplayName = operation.displayName;
      }
    }

    for (const subscription of environment.subscriptions) {
      subscription.displayName = displayName(subscription);
      subscription.fullName = fullName(subscription, environment);
      subscription.fullDisplayName = fullDisplayName(subscription, environment);
    }

    for (const product of environment.products) {
      product.displayName = displayName(product);
      product.fullName = fullName(product, environment);
      product.fullDisplayName = fullDisplayName(product, environment);
    }
  }

  return input;
}

function expandPlaceholders(input) {
  function replace(str, obj, environment, api) {
    return str
      .replace(/\$\{([^}]+)\}/g, (str, key) => {
        if (key === "environment.name") {
          return environment.name;
        } else if (key === "api.name") {
          if (api == null) {
            throw new Error(`placeholder used outside API: ${str}`);
          }
          return api.name;
        } else if (key === "name") {
          return obj.name;
        }

        const variable = environment.variables.find(v => v.name === key);
        if (variable) {
          return replace(variable.value, obj, environment, api);
        }

        throw new Error(`could not resolve placeholder: ${str}`);
      })
      .replace(/\$\[([^\]]+)\]/g, (str, key) => {
        const property = api.properties.find(p => p.name === key);
        if (property) {
          return `{{${property.fullDisplayName}}}`;
        } else {
          throw new Error(`could not resolve placeholder: ${str}`);
        }
      });
  }

  const { environments } = input;

  for (const environment of environments) {
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

    for (const subscription of environment.subscriptions) {
      subscription.scope.product = replace(
        subscription.scope.product,
        subscription,
        environment
      );
    }
  }

  return input;
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

    for (const variable of environment.variables) {
      if (variable.name === "name") {
        errors.push(`invalid variable name: ${variable.name}`);
      }
    }

    if (environment.apis.length > 0 && !environment.configuration) {
      errors.push(`configuration missing for environment ${environment.name}`);
    }

    for (const api of environment.apis) {
      for (const operation of api.operations) {
        for (const p of operation.queryParameters) {
          if (p.defaultValue != null && !p.values.includes(p.defaultValue)) {
            errors.push(`parameter defaultValue missing in values: ${p.name}`);
          }
        }
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
      path === "-"
        ? [path]
        : walk(resolve(path), (p, dir) =>
            dir
              ? !p.endsWith("node_modules") && !p.endsWith("/.git")
              : p.endsWith(".yml") || p.endsWith(".yaml")
          )
    )
  );
}

module.exports = { generate };
