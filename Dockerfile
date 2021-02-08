FROM renovate/renovate:19.225.3-slim

FROM busybox:1.33.0

# renovate: datasource=npm depName=yarn versioning=npm
ARG YARN_VERSION=1.22.0

# renovate: datasource=npm depName=pnpm versioning=npm
ARG PNPM_VERSION=4.0.0

# renovate: datasource=docker depName=python versioning=docker
ARG PYTHON_VERSION=3.7.7

# renovate: datasource=github-releases depName=helm/helm
ARG HELM_VERSION=3.4.0

ARG FLAVOR=latest
ENTRYPOINT [ "echo", "${FLAVOR} | " ]
