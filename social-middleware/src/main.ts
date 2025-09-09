import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import * as cookieParser from 'cookie-parser';
import { Logger } from 'nestjs-pino';
import { ValidationPipe } from '@nestjs/common';
import { BullDashboardService } from './bull-dashboard/bull-dashboard.service';

async function bootstrap() {
  try {
    const app = await NestFactory.create(AppModule.register(), {
      bufferLogs: true,
    });

    const logger = app.get(Logger);
    app.useLogger(logger);

    const bullDashboard = app.get(BullDashboardService);
    app.use('/admin/queues', bullDashboard.getRouter());

    // load config
    const config = app.get(ConfigService);

    const port = config.get<number>('PORT') || 3001;
    const frontendUrl =
      config.get<string>('FRONTEND_URL') || 'http://localhost:5173';
    const isDevelopment = config.get<string>('NODE_ENV') !== 'production';
    const apiUrl = config.get<string>('API_URL') || 'http://localhost:3001';
    const formsUrl = config.get<string>('FORMS_URL') || 'http://localhost:8080';
    // Enable CORS to handle preflight OPTIONS requests
    const allowedOrigins = [frontendUrl, apiUrl, formsUrl];
    logger.log('🔧 CORS Configuration:');
    logger.log('Allowed origins:', allowedOrigins);

    app.enableCors({
      origin: (
        origin: string | undefined,
        callback: (error: Error | null, allow?: boolean) => void,
      ) => {
        logger.log('Incoming request origin:', origin);
        logger.log('Checking against allowed origins:', allowedOrigins);

        if (!origin) return callback(null, true);

        if (allowedOrigins.includes(origin)) {
          logger.log('Origin allowed');
          return callback(null, true);
        }

        logger.log('Origin rejected');
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
      .addCookieAuth('session', {
        type: 'apiKey',
        in: 'cookie',
        name: 'session',
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

    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true, // strip unknown properties from DTOs
        forbidNonWhitelisted: true, // throw error if unknown properties are present
        transform: true, // automatically transform payloads to DTO instances
        disableErrorMessages: isDevelopment ? false : true, // enable detailed error messages (set to true in production for security)
        validationError: {
          target: false, // do not expose the original object in errors
          value: false, // do not expose the value that failed validation
        },
      }),
    );

    await app.listen(port);
    logger.log(`🚀 Server running at http://localhost:${port}/health`);
  } catch (error) {
    console.error('❌ Failed to create NestJS app:', error);
    throw error;
  }
}
bootstrap().catch((err) => {
  console.error('Bootstrap failed', err);
  process.exit(1);
});
