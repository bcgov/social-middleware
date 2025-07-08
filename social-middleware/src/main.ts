import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });
  const config = app.get(ConfigService);
  const port = config.get<number>('PORT') || 3001;
  
  app.useLogger(app.get(Logger));

  await app.listen(port);
  console.log(`🚀 Server running at http://localhost:${port}/health`);
}
bootstrap();
