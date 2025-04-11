FROM node:22-alpine

RUN adduser -D -g apimtpl apimtpl

COPY . /tmp/src/

RUN yarn global add "file:/tmp/src" \
    && rm -rf /tmp/src

WORKDIR /home/apimtpl
USER apimtpl
ENTRYPOINT [ "apimtpl" ]
