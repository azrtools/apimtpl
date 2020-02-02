const { toTitleCase, clone } = require("./utils");

function createTemplate(input) {
  const environments = createEnvironments(input);

  const resources = [
    ...environments.flatMap(env => [
      ...env._arm.apis.map(createApi),
      ...env._arm.apis.flatMap(api => [
        ...api.properties.map(createProperty),
        ...api.operations.map(createOperation),
        createPolicies(api.policies)
      ])
    ])
  ].map(resource => {
    resource.name = `[concat(parameters('serviceName'), '/${resource.name}')]`;
    resource.apiVersion = "2019-01-01";
    resource.dependsOn = (resource.dependsOn || []).concat([
      "[resourceId('Microsoft.ApiManagement/service', parameters('serviceName'))]"
    ]);
    return resource;
  });

  return {
    $schema:
      "https://schema.management.azure.com/schemas/2015-01-01/deploymentTemplate.json#",
    contentVersion: "1.0.0.0",
    parameters: {
      serviceName: { type: "String", defaultValue: "" }
    },
    variables: {},
    resources
  };
}

function createEnvironments(input) {
  function name(...objs) {
    return objs.map(obj => obj.name).join("-");
  }

  function displayName(...objs) {
    return objs
      .map(obj => obj.displayName || toTitleCase(obj.name))
      .join(" - ");
  }

  function propertyDisplayName(...objs) {
    return objs
      .map(obj => displayName(obj))
      .map(str => str.replace(/[^A-Za-z0-9]/g, ""))
      .join("-");
  }

  function dependOnApi(api) {
    return `[resourceId('Microsoft.ApiManagement/service/apis', parameters('serviceName'), '${api._arm.name}')]`;
  }

  function replace(str, api) {
    return str.replace(/\$\[([^\]]+)\]/g, (str, key) => {
      if (api) {
        const property = api.properties.find(p => p.name === key);
        if (property) {
          return `{{${property._arm.displayName}}}`;
        }
      }

      throw new Error(`could not resolve placeholder: ${str}`);
    });
  }

  const environments = clone(input.environments);

  for (const environment of environments) {
    environment._arm = {
      apis: clone(input.apis)
    };

    for (const api of environment._arm.apis) {
      api._arm = {
        name: name(api, environment),
        displayName: displayName(api, environment)
      };

      for (const property of api.properties) {
        property._arm = {
          name: name(api, environment, property),
          displayName: propertyDisplayName(api, environment, property)
        };
      }

      for (const operation of api.operations) {
        operation._arm = {
          name: `${api._arm.name}/${operation.name}`,
          displayName: displayName(operation),
          dependsOn: [dependOnApi(api)]
        };
      }

      api.policies._arm = {
        name: `${api._arm.name}/policy`,
        dependsOn: [dependOnApi(api)]
      };

      for (const [key, value] of Object.entries(api.policies)) {
        if (typeof value === "string") {
          api.policies._arm[key] = replace(value, api);
        }
      }
    }
  }

  return environments;
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

function createPolicies(policies) {
  return {
    type: "Microsoft.ApiManagement/service/apis/policies",
    name: policies._arm.name,
    dependsOn: policies._arm.dependsOn,
    properties: {
      value:
        "<policies>" +
        ["inbound", "backend", "outbound", "on-error"]
          .map(key => `<${key}>${policies._arm[key] || "<base />"}</${key}>`)
          .join("") +
        "</policies>",
      format: "xml"
    }
  };
}

module.exports = { createTemplate };
