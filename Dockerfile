FROM node:lts

WORKDIR /app
COPY . .

RUN apt-get update
RUN npm install
RUN npm install -g pm2
RUN npm install -g @babel/core @babel/cli @babel/node
RUN apt-get install -y graphicsmagick

CMD [ "pm2-runtime", "start", "pm2.json" ]