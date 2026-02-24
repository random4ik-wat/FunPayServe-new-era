FROM node:20-alpine

WORKDIR /usr/src/app

COPY package*.json ./

RUN npm ci --production

COPY . .

# Данные будут сохраняться через volume
VOLUME ["/usr/src/app/data", "/usr/src/app/settings.txt"]

CMD ["node", "."]
