function createTemplate(input) {
  return {
    $schema:
      "https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#",
    contentVersion: "1.0.0.0",
    parameters: {},
    variables: {},
    resources: generateResources(input)
  };
}

function generateResources(input) {
  function resourceIdApi(serviceName, api) {
    return `[resourceId('Microsoft.ApiManagement/service/apis', '${serviceName}', '${api.fullName}')]`;
  }

  function resourceIdOperation(serviceName, api, operation) {
    return `[resourceId('Microsoft.ApiManagement/service/apis/operations', '${serviceName}', '${api.fullName}', '${operation.name}')]`;
  }

  function resourceIdProduct(serviceName, product) {
    return `[resourceId('Microsoft.ApiManagement/service/products', '${serviceName}', '${product.fullName}')]`;
  }

  function replaceAll(api, policies) {
    for (const [key, value] of Object.entries(policies)) {
      if (typeof value === "string") {
        policies[key] = value.replace(/\$\[([^\]]+)\]/g, (str, key) => {
          const property = api.properties.find(p => p.name === key);
          if (property) {
            return `{{${property.fullDisplayName}}}`;
          } else {
            throw new Error(`could not resolve placeholder: ${str}`);
          }
        });
      }
    }
    return policies;
  }

  const resources = [];

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

  for (const environment of input.environments) {
    const { serviceName } = environment.configuration;

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
        }
      });

      for (const property of api.properties) {
        addResource({
          type: "Microsoft.ApiManagement/service/properties",
          name: `${serviceName}/${property.fullName}`,
          properties: {
            displayName: property.fullDisplayName,
            value: property.value,
            secret: property.secret || false
          }
        });
      }

      for (const operation of api.operations) {
        addResource({
          type: "Microsoft.ApiManagement/service/apis/operations",
          name: `${serviceName}/${operation.fullName}`,
          dependsOn: [apiResourceId],
          properties: {
            displayName: operation.fullDisplayName,
            method: operation.method,
            urlTemplate: operation.path,
            templateParameters: [],
            responses: []
          }
        });

        const operationResourceId = resourceIdOperation(
          serviceName,
          api,
          operation
        );

        if (Object.keys(operation.policies).length > 0) {
          addResource({
            type: "Microsoft.ApiManagement/service/apis/operations/policies",
            name: `${serviceName}/${operation.fullName}/policy`,
            dependsOn: [operationResourceId, apiResourceId],
            properties: {
              value: createPoliciesXml(replaceAll(api, operation.policies)),
              format: "xml"
            }
          });
        }
      }

      if (Object.keys(api.policies).length > 0) {
        addResource({
          type: "Microsoft.ApiManagement/service/apis/policies",
          name: `${serviceName}/${api.fullName}/policy`,
          dependsOn: [apiResourceId],
          properties: {
            value: createPoliciesXml(replaceAll(api, api.policies)),
            format: "xml"
          }
        });
      }
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
            dependsOn: [product.fullName, resourceIdApi(serviceName, api)]
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

  return resources;
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

module.exports = { createTemplate };
