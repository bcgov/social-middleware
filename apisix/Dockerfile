FROM apache/apisix:3.9.0-debian

USER root

# Make the default config directory writable so APISIX CLI can write .customized_config_path
RUN touch /usr/local/apisix/conf/.customized_config_path && \
    chgrp -R 0 /usr/local/apisix/conf && \
    chmod -R g+rwX /usr/local/apisix/conf

# Create safe custom config path
RUN mkdir -p /var/apisix/conf && \
    chgrp -R 0 /var/apisix && \
    chmod -R g+rwX /var/apisix

USER 1001

EXPOSE 9080 9443

HEALTHCHECK --interval=10s --timeout=5s --start-period=10s \
  CMD curl -f http://localhost:9080/apisix/admin/routes || exit 1

CMD ["sh", "-c", "apisix start -c /var/apisix/conf/config.yaml && tail -f /usr/local/apisix/logs/error.log"]
