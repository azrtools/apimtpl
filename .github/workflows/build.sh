#!/bin/sh

set -e

repository="azrtools/apimtpl"
platforms="linux/amd64,linux/arm64"

build_docker() {
  tag="$repository:$1"
  echo "Building $tag..."
  docker buildx build --push --platform="$platforms" . -t "$tag"
}

echo "${DOCKER_PASSWORD}" |
  docker login -u "${DOCKER_USERNAME}" --password-stdin

if [ "$REF_NAME" = "main" ]; then
  build_docker "latest"
elif echo "$REF_NAME" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+$'; then
  build_docker "$REF_NAME"
fi
