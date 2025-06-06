import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { readFile } from "fs/promises";

import Ajv from "ajv";

import { readYaml, merge, walk, clone, toTitleCase } from "./utils.js";
import { generateOutput } from "./arm.js";

const schemaPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../config-schema.json"
);

export async function generate(paths) {
  const input = await combine(paths)
    .then(validateInput)
    .then(cloneInput)
    .then(expandNames)
    .then(expandPlaceholders)
    .then(validateExpanded)
    .then(validateUser);
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
  const schema = JSON.parse(await readFile(schemaPath, "utf8"));

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

  const { validation, parameters } = input;
  return { validation, parameters, environments };
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
      if (!api.path) {
        errors.push(`API path missing: ${api.name}`);
      }

      if (api.operations.length < 1) {
        errors.push(`no operations given: ${api.name}`);
      }

      for (const operation of api.operations) {
        if (!operation.method) {
          errors.push(`operation method missing: ${operation.name}`);
        }

        if (!operation.path) {
          errors.push(`operation path missing: ${operation.name}`);
        }

        for (const p of operation.queryParameters) {
          validateParameter(p, errors);
        }

        for (const p of operation.templateParameters) {
          validateParameter(p, errors);
        }
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(errors.join("; "));
  }

  return input;
}

function validateParameter(p, errors) {
  if (p.defaultValue != null && !p.values.includes(p.defaultValue)) {
    if (p.values.length === 0) {
      p.values = [p.defaultValue];
    } else {
      errors.push(`parameter defaultValue missing in values: ${p.name}`);
    }
  }
}

function validateUser(input) {
  const errors = [];

  const { api, environment, operation, product, subscription } =
    input.validation;

  const checkMatch = (type, property, pattern, obj) => {
    const s = obj[property];
    const p = pattern[property];
    if (s.match(`^${p}$`) == null) {
      errors.push(`${type} ${property} '${s}' does not match pattern '${p}'`);
    }
  };

  for (const e of input.environments) {
    checkMatch("environment", "name", environment, e);
    checkMatch("environment", "displayName", environment, e);

    for (const p of e.products) {
      checkMatch("product", "name", product, p);
      checkMatch("product", "displayName", product, p);
    }

    for (const s of e.subscriptions) {
      checkMatch("subscription", "name", subscription, s);
      checkMatch("subscription", "displayName", subscription, s);
    }

    for (const a of e.apis) {
      checkMatch("api", "name", api, a);
      checkMatch("api", "displayName", api, a);
      checkMatch("api", "path", api, a);

      for (const o of a.operations) {
        checkMatch("operation", "name", operation, o);
        checkMatch("operation", "displayName", operation, o);
        checkMatch("operation", "path", operation, o);
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
