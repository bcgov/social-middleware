import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import * as cookieParser from 'cookie-parser';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  const port = config.get<number>('PORT') || 3001;

   // Enable CORS to handle preflight OPTIONS requests
   app.enableCors({
    origin: true, // Allow all origins in development, or specify your frontend URL
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  });

  app.use(cookieParser());

  await app.listen(port);
  console.log(`🚀 Server running at http://localhost:${port}/health`);
}
bootstrap();
