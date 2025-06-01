FROM node:23-alpine-slim
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm install --production
COPY . .
CMD ["npm", "start"]