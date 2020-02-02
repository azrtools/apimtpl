const { toTitleCase, startsWithUppercase, clone } = require("./utils");

function createTemplate(input) {
  const { environments } = generateProperties(clone(input));

  const resources = [
    ...environments.flatMap(env => [
      ...env.apis.map(createApi),
      ...env.apis.flatMap(api => [
        ...api.properties.map(createProperty),
        ...api.operations.map(createOperation),
        ...api.operations.map(op => createOperationPolicies(op.policies)),
        createPolicies(api.policies)
      ]),
      ...env.products.map(createProduct),
      ...env.subscriptions.map(createSubscription)
    ])
  ];

  resources.forEach(resource => {
    resource.name = `[concat(parameters('serviceName'), '/${resource.name}')]`;
    resource.apiVersion = "2019-01-01";
    if (resource.resources) {
      resource.resources.forEach(res => (res.apiVersion = "2019-01-01"));
    }
  });

  return {
    $schema:
      "https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#",
    contentVersion: "1.0.0.0",
    parameters: {
      serviceName: { type: "string", defaultValue: "" }
    },
    variables: {},
    resources
  };
}

function generateProperties(input) {
  function name(...objs) {
    return objs.map(obj => obj.name).join("-");
  }

  function displayName(...objs) {
    return objs
      .map(
        obj =>
          obj.displayName ||
          (startsWithUppercase(obj.name) ? obj.name : toTitleCase(obj.name))
      )
      .join(" - ");
  }

  function propertyDisplayName(...objs) {
    return objs
      .map(obj => toTitleCase(obj.displayName || obj.name))
      .map(str => str.replace(/[^A-Za-z0-9]/g, ""))
      .join("-");
  }

  function resourceIdApi(api) {
    return `[resourceId('Microsoft.ApiManagement/service/apis', parameters('serviceName'), '${api._arm.name}')]`;
  }

  function resourceIdOperation(api, operation) {
    return `[resourceId('Microsoft.ApiManagement/service/apis/operations', parameters('serviceName'), '${api._arm.name}', '${operation.name}')]`;
  }

  function resourceIdProduct(product) {
    return `[resourceId('Microsoft.ApiManagement/service/products', parameters('serviceName'), '${product._arm.name}')]`;
  }

  function replace(str, api) {
    return str.replace(/\$\[([^\]]+)\]/g, (str, key) => {
      const property = api.properties.find(p => p.name === key);
      if (property) {
        return `{{${property._arm.displayName}}}`;
      } else {
        throw new Error(`could not resolve placeholder: ${str}`);
      }
    });
  }

  for (const environment of input.environments) {
    for (const api of environment.apis) {
      api._arm = {
        name: name(api, environment),
        displayName: displayName(api, environment)
      };

      api._arm.resourceId = resourceIdApi(api);

      for (const property of api.properties) {
        const scope = { name: "default" };
        property._arm = {
          name: name(api, environment, scope, property),
          displayName: propertyDisplayName(api, environment, scope, property)
        };
      }

      for (const operation of api.operations) {
        operation._arm = {
          name: `${api._arm.name}/${operation.name}`,
          displayName: displayName(operation),
          dependsOn: [api._arm.resourceId],
          resourceId: resourceIdOperation(api, operation)
        };

        operation.policies._arm = {
          name: `${operation._arm.name}/policy`,
          dependsOn: [operation._arm.resourceId, api._arm.resourceId]
        };

        for (const [key, value] of Object.entries(operation.policies)) {
          if (typeof value === "string") {
            operation.policies._arm[key] = replace(value, api);
          }
        }
      }

      api.policies._arm = {
        name: `${api._arm.name}/policy`,
        dependsOn: [api._arm.resourceId]
      };

      for (const [key, value] of Object.entries(api.policies)) {
        if (typeof value === "string") {
          api.policies._arm[key] = replace(value, api);
        }
      }
    }

    for (const product of environment.products) {
      product._arm = {
        name: name(product, environment),
        displayName: displayName(product, environment),
        apis: product.apis.map(name =>
          environment.apis.find(api => api.name === name)
        )
      };

      product._arm.resourceId = resourceIdProduct(product);
    }

    for (const subscription of environment.subscriptions) {
      subscription._arm = {
        name: name(subscription, environment),
        displayName: displayName(subscription, environment),
        product: environment.products.find(
          product => product.name === subscription.scope.product
        )
      };
    }
  }

  return input;
}

function createApi(api) {
  return {
    type: "Microsoft.ApiManagement/service/apis",
    name: api._arm.name,
    properties: {
      displayName: api._arm.displayName,
      apiRevision: "1",
      subscriptionRequired: true,
      path: api.path,
      protocols: ["https"],
      isCurrent: true
    }
  };
}

function createProperty(property) {
  return {
    type: "Microsoft.ApiManagement/service/properties",
    name: property._arm.name,
    properties: {
      displayName: property._arm.displayName,
      value: property.value,
      secret: property.secret || false
    }
  };
}

function createOperation(operation) {
  return {
    type: "Microsoft.ApiManagement/service/apis/operations",
    name: operation._arm.name,
    dependsOn: operation._arm.dependsOn,
    properties: {
      displayName: operation._arm.displayName,
      method: operation.method,
      urlTemplate: operation.path,
      templateParameters: [],
      responses: []
    }
  };
}

function createOperationPolicies(policies) {
  return {
    type: "Microsoft.ApiManagement/service/apis/operations/policies",
    name: policies._arm.name,
    dependsOn: policies._arm.dependsOn,
    properties: {
      value: createPoliciesXml(policies),
      format: "xml"
    }
  };
}

function createPolicies(policies) {
  return {
    type: "Microsoft.ApiManagement/service/apis/policies",
    name: policies._arm.name,
    dependsOn: policies._arm.dependsOn,
    properties: {
      value: createPoliciesXml(policies),
      format: "xml"
    }
  };
}

function createPoliciesXml(policies) {
  return (
    "<policies>" +
    ["inbound", "backend", "outbound", "on-error"]
      .map(key => `<${key}>${policies._arm[key] || "<base />"}</${key}>`)
      .join("") +
    "</policies>"
  );
}

function createProduct(product) {
  return {
    type: "Microsoft.ApiManagement/service/products",
    name: product._arm.name,
    properties: {
      displayName: product._arm.displayName,
      description: product._arm.displayName,
      subscriptionRequired: true,
      approvalRequired: false,
      state: "published"
    },
    resources: product._arm.apis.map(api => ({
      type: "apis",
      name: api._arm.name,
      dependsOn: [product._arm.name, api._arm.resourceId],
      properties: {}
    }))
  };
}

function createSubscription(subscription) {
  return {
    type: "Microsoft.ApiManagement/service/subscriptions",
    name: subscription._arm.name,
    dependsOn: [subscription._arm.product._arm.resourceId],
    properties: {
      scope: subscription._arm.product._arm.resourceId,
      displayName: subscription._arm.displayName,
      state: "active",
      allowTracing: true
    }
  };
}

module.exports = { createTemplate };
