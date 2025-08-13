import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import * as cookieParser from 'cookie-parser';
import { Logger } from 'nestjs-pino';

async function bootstrap() {
  try {
    const app = await NestFactory.create(AppModule.register(), {
      bufferLogs: true,
    });

    // load config
    const config = app.get(ConfigService);


    const frontendUrl =
      config.get<string>('FRONTEND_URL') || 'http://localhost:5173';
    const apiUrl = config.get<string>('API_URL') || 'http://localhost:3001';
    // Enable CORS to handle preflight OPTIONS requests
    const allowedOrigins = [frontendUrl, apiUrl];
    console.log('🔧 CORS Configuration:');
    console.log('Allowed origins:', allowedOrigins);

    app.enableCors({
      origin: (
        origin: string | undefined,
        callback: (error: Error | null, allow?: boolean) => void,
      ) => {
        console.log('Incoming request origin:', origin);
        console.log('Checking against allowed origins:', allowedOrigins);

        if (!origin) return callback(null, true);

        if (allowedOrigins.includes(origin)) {
          console.log('Origin allowed');
          return callback(null, true);
        }

        console.log('Origin rejected');
        return callback(new Error('Not allowed by CORS'));
      },
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-Requested-With',
        'Accept',
        'Origin',
      ],
      credentials: true,
      preflightContinue: false,
      optionsSuccessStatus: 204,
    });

    const swaggerConfig = new DocumentBuilder()
      .setTitle('Caregiver Middleware API')
      .setDescription(
        'APIs used in the middleware of Caregiver Portal are documented here',
      )
      .setVersion('1.0')
      .addCookieAuth('session_token', {
        type: 'apiKey',
        in: 'cookie',
        name: 'session_token',
        description: 'Session token for authenticated requests',
      })
      .addCookieAuth('refresh_token', {
        type: 'apiKey',
        in: 'cookie',
        name: 'refresh_token',
        description: 'Refresh token for session renewal',
      })
      .addCookieAuth('id_token', {
        type: 'apiKey',
        in: 'cookie',
        name: 'id_token',
        description: 'OpenID Connect ID token',
      })
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api', app, document);

    app.use(cookieParser());

    app.useLogger(app.get(Logger));

    await app.listen(port);
    console.log(`🚀 Server running at http://localhost:${port}/health`);
  } catch (error) {
    console.error('❌ Failed to create NestJS app:', error);
    throw error;
  }
}
bootstrap().catch((err) => {
  console.error('Bootstrap failed', err);
  process.exit(1);
});
