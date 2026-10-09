#!/bin/sh
# Railway tells the app which port to listen on in PORT.
sed -i "s/^listen = .*/listen = \"0.0.0.0:${PORT:-6665}\"/" /app/Config.toml
exec /app/sculptor
