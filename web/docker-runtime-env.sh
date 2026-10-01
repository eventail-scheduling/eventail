#!/bin/sh

envsubst < /usr/share/nginx/html/runtime-env.js.tpl > /tmp/runtime-env.js
