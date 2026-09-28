#!/bin/sh

envsubst < /usr/share/nginx/html/runtime-env.js.tpl > /usr/share/nginx/html/runtime-env.js
