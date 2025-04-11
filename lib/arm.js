export function generateOutput(input) {
  const output = {};

  const { resources, parameters } = generateTemplate(input);
  if (resources.length > 0) {
    output["azuredeploy.json"] = {
      $schema:
        "https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#",
      contentVersion: "1.0.0.0",
      parameters,
      variables: {},
      resources
    };
  }

  const parameterValues = generateParameters(input);
  if (Object.keys(parameterValues).length > 0) {
    output["parameters.json"] = {
      $schema:
        "https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#",
      contentVersion: "1.0.0.0",
      parameters: parameterValues
    };
  }

  return output;
}

function generateTemplate(input) {
  const resources = [];
  const parameters = {};

  function addResource(resource) {
    function update(resource) {
      resource.apiVersion = "2019-01-01";
      if (!resource.properties) {
        resource.properties = {};
      }
    }
    update(resource);
    if (resource.resources) {
      resource.resources.forEach(update);
    }
    resources.push(resource);
  }

  function resourceIdApi(serviceName, api) {
    return `[resourceId('Microsoft.ApiManagement/service/apis', '${serviceName}', '${api.fullName}')]`;
  }

  function resourceIdOperation(serviceName, api, operation) {
    return `[resourceId('Microsoft.ApiManagement/service/apis/operations', '${serviceName}', '${api.fullName}', '${operation.name}')]`;
  }

  function resourceIdProduct(serviceName, product) {
    return `[resourceId('Microsoft.ApiManagement/service/products', '${serviceName}', '${product.fullName}')]`;
  }

  function toArray(obj, result) {
    return Object.keys(obj).length === 0 ? [] : [result];
  }

  function replaceParameter(obj) {
    if (obj && obj.parameter) {
      const name = obj.parameter;
      parameters[name] = { type: "securestring" };
      return `[parameters('${name}')]`;
    } else {
      return obj;
    }
  }

  for (const environment of input.environments) {
    const { serviceName } = environment.configuration;

    let previousApiId = null;

    for (const api of environment.apis) {
      const apiResourceId = resourceIdApi(serviceName, api);

      addResource({
        type: "Microsoft.ApiManagement/service/apis",
        name: `${serviceName}/${api.fullName}`,
        properties: {
          displayName: api.fullDisplayName,
          apiRevision: "1",
          subscriptionRequired: true,
          path: api.path,
          protocols: ["https"],
          isCurrent: true
        },
        dependsOn: previousApiId == null ? [] : [previousApiId],
        resources: toArray(api.policies, {
          type: "policies",
          name: "policy",
          dependsOn: [api.fullName],
          properties: {
            value: createPoliciesXml(api.policies),
            format: "xml"
          }
        })
      });

      for (const property of api.properties) {
        if (property.value != null) {
          addResource({
            type: "Microsoft.ApiManagement/service/properties",
            name: `${serviceName}/${property.fullName}`,
            properties: {
              displayName: property.fullDisplayName,
              value: replaceParameter(property.value),
              secret: property.secret || false
            }
          });
        }
      }

      let previousOperationId = null;

      for (const operation of api.operations) {
        addResource({
          type: "Microsoft.ApiManagement/service/apis/operations",
          name: `${serviceName}/${operation.fullName}`,
          dependsOn:
            previousOperationId == null
              ? [apiResourceId]
              : [apiResourceId, previousOperationId],
          properties: {
            displayName: operation.fullDisplayName,
            method: operation.method,
            urlTemplate: operation.path,
            templateParameters: operation.templateParameters,
            request: {
              queryParameters: operation.queryParameters
            },
            responses: []
          },
          resources: toArray(operation.policies, {
            type: "policies",
            name: "policy",
            dependsOn: [apiResourceId, operation.name],
            properties: {
              value: createPoliciesXml(operation.policies),
              format: "xml"
            }
          })
        });
        previousOperationId = resourceIdOperation(serviceName, api, operation);
      }

      previousApiId = apiResourceId;
    }

    for (const product of environment.products) {
      addResource({
        type: "Microsoft.ApiManagement/service/products",
        name: `${serviceName}/${product.fullName}`,
        properties: {
          displayName: product.fullDisplayName,
          description: product.fullDisplayName,
          subscriptionRequired: true,
          approvalRequired: false,
          state: "published"
        },
        resources: product.apis
          .map(name => environment.apis.find(api => api.name === name))
          .map(api => ({
            type: "apis",
            name: api.fullName,
            dependsOn: [resourceIdApi(serviceName, api), product.fullName]
          }))
      });
    }

    for (const subscription of environment.subscriptions) {
      const productResourceId = resourceIdProduct(
        serviceName,
        environment.products.find(
          product => product.name === subscription.scope.product
        )
      );

      addResource({
        type: "Microsoft.ApiManagement/service/subscriptions",
        name: `${serviceName}/${subscription.fullName}`,
        dependsOn: [productResourceId],
        properties: {
          scope: productResourceId,
          displayName: subscription.fullDisplayName,
          state: "active",
          allowTracing: true
        }
      });
    }
  }

  return { resources, parameters };
}

function createPoliciesXml(policies) {
  return (
    "<policies>" +
    ["inbound", "backend", "outbound", "on-error"]
      .map(
        key =>
          `<${key}>${
            policies[key] == null ? "<base />" : policies[key]
          }</${key}>`
      )
      .join("") +
    "</policies>"
  );
}

function generateParameters(input) {
  const parameters = {};

  for (const parameter of input.parameters) {
    parameters[parameter.name] = { value: parameter.value };
  }

  return parameters;
}
