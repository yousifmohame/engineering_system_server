# استخدام نسخة debian-slim المتوافقة تماماً مع Prisma
FROM node:22-slim

# تثبيت مكتبات OpenSSL الضرورية لعمل Prisma
RUN apt-get update -y && apt-get install -y openssl

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/

RUN npm install
RUN npx prisma generate

COPY . .

EXPOSE 5000

RUN mkdir -p /app/uploads/settlements
RUN chmod -R 777 /app/uploads

# السطر الأخير الذي يشغل المشروع
CMD ["npm", "run", "dev"]