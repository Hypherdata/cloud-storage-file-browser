FROM node:14
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY job-compare-images.js .
CMD [ "node", "job-compare-images.js" ]
