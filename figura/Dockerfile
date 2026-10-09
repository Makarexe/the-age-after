# Figura cloud for our accounts: Sculptor, an open-source Figura backend (GPL-3.0).
FROM ghcr.io/shiroyashik/sculptor:v0.4.2 AS sculptor

# Only the (static) binary is taken: Railway rejects images with Docker VOLUMEs, which the
# upstream image declares. Avatars go to a Railway volume mounted at /app/data instead.
FROM alpine:3.22
RUN apk add --no-cache tzdata
WORKDIR /app
COPY --from=sculptor /app/sculptor /app/sculptor
COPY Config.toml start.sh /app/
EXPOSE 6665
ENTRYPOINT ["/bin/sh", "/app/start.sh"]
