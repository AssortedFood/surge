FROM node:22.16.0-alpine3.22
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm install --production
COPY . .
CMD ["npm", "start"]