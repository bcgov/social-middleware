import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import * as cookieParser from 'cookie-parser';
import { Logger } from 'nestjs-pino';

async function bootstrap() {
  //console.log('1 - Starting bootstrap');
  try {
    //console.log('2 - Creating NestJS app...');
    const app = await NestFactory.create(AppModule, {
      bufferLogs: true,
    });
    
    //console.log('3 - NestJS app created successfully');
    
    const config = app.get(ConfigService);
    const port = config.get<number>('PORT') || 3001;
    const frontendUrl = config.get<string>('FRONTEND_URL') || 'http://localhost:5173';
    console.log('FRONTEND_URL from config:', frontendUrl);

       // Enable CORS to handle preflight OPTIONS requests

   


   const allowedOrigins = [frontendUrl];

   console.log('🔧 CORS Configuration:');

   console.log('Allowed origins:', allowedOrigins);

   app.enableCors({
    origin: (origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) => {
      console.log('Incoming request origin:', origin);
      console.log('Checking against allowed origins:', allowedOrigins);

      if(!origin) return callback(null, true);

      if(allowedOrigins.includes(origin)) {
        console.log('Origin allowed');
        return callback(null, true);
      }

      console.log('Origin rejected');
      return callback(new Error('Not allowed by CORS'));

    }, 
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 
                    'Authorization',
                    'X-Requested-With',
                    'Accept',
                    'Origin'],
    credentials: true,
    preflightContinue: false,
    optionsSuccessStatus: 204
  });
  const config = app.get(ConfigService);
  const port = config.get<number>('PORT') || 3001;

  app.use(cookieParser());
  
  app.useLogger(app.get(Logger));

  await app.listen(port);
  console.log(`🚀 Server running at http://localhost:${port}/health`);

  } catch(error) {
    console.error('❌ Failed to create NestJS app:', error);
    throw error;
  }
  

}
bootstrap().catch(err => {
  console.error("Bootstrap failed", err);
  process.exit(1);
});
