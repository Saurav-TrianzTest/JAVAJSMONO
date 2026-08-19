# cz-js-1038 single-stage Dockerfile (no multi-stage)
FROM node:18
WORKDIR /app
COPY . .
RUN npm install
# cz-js-1037 build without production optimization
RUN npm run build
# cz-js-1039 hardcoded build output path
COPY /app/build /var/www/html
EXPOSE 3000
CMD ["npm", "start"]
