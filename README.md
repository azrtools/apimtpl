# apimtpl

Azure API Management template generator

## Usage

You can run `apimtpl` via Docker:

```sh
docker run --rm -it azrtools/apimtpl --help
```

If you have an input file `/home/user/api.yaml`, you can generate ARM templates
using the following command:

```sh
docker run --rm -it -v "/home/user/api.yaml:/api.yaml" azrtools/apimtpl \
    /api.yaml >/home/user/api/output.json
```

The output will be written to `/home/user/api/output.json`

## Configuration

The most basic input file looks like this:

```yaml
configuration:
  serviceName: apim-service
environments:
  - name: development
apis:
  - name: example-api
    path: example-api
    operations:
      - name: ping
        method: POST
        path: /ping
```

To also generate products and subscriptions, additionally use this input:

```yaml
products:
  - name: example
    apis:
      - example-api
subscriptions:
  - name: example
    scope:
      product: example
```

You can put the input into one file or split it into multiple files, for
example to have one API definition per file.
It's also possible to put multiple YAML documents (separated by `---`) into one
file.

### Properties

Properties (called _Named values_ in the Azure portal) can be used to store
credentials like usernames or passwords.

You can reference properties in the policy using the `$[property-name]` syntax.

```yaml
environments:
  - name: development
apis:
  - name: example-api
    path: example-api
    policies:
      inbound: |
        <base />
        <set-backend-service base-url="https://example.com" />
        <authentication-basic username="$[username]" password="$[password]" />
    properties:
      - name: username
        value: user001
      - name: password
        value: password123
        secret: true
    operations:
      - name: get-data
        method: GET
        path: /data
```

### Environment-specific configuration

The top-level `apis` key specifies API configuration that applies to all
environments. To set some configuration values only for specific environments,
you can use the `apis` key below the desired environment:

```yaml
environments:
  - name: development
apis:
  - name: example-api
    path: example-api
    policies:
      inbound: |
        <base />
        <set-backend-service base-url="https://example.com" />
    operations:
      - name: get-data
        method: GET
        path: /data
---
environments:
  - name: development
    apis:
      - name: example-api
        policies:
          inbound: |
            <base />
            <set-backend-service base-url="https://development.example.com" />
```

## Related projects

- https://github.com/Azure/azure-api-management-devops-resource-kit
- https://github.com/mirsaeedi/dotnet-apim

## License

[MIT](LICENSE)
