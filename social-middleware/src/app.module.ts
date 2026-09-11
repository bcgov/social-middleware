import { HttpModule } from '@nestjs/axios';
import { BullModule } from '@nestjs/bull';
import { DynamicModule, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { LoggerModule } from 'nestjs-pino';
import pino from 'pino';
import { ApplicationFormModule } from './application-form/application-form.module';
import { ApplicationPackageModule } from './application-package/application-package.module';
import { AttachmentsModule } from './attachments/attachments.module';
import { AuthModule } from './auth/auth.module';
import { BullDashboardModule } from './bull-dashboard/bull-dashboard.module';
import { DataRetentionModule } from './data-retention/data-retention.module';
import { DatabaseModule } from './database/database.module';
import { DevToolsModule } from './dev-tools/dev-tools.module';
import { FormsModule } from './forms/forms.module';
import { HealthModule } from './health/health.module';
import { HouseholdModule } from './household/household.module';
import { NotificationModule } from './notifications/notification.module';
import { SiebelModule } from './siebel/siebel.module';

@Module({})
export class AppModule {
  static register(): DynamicModule {
    const isDevelopment = ['development', 'local'].includes(
      process.env.NODE_ENV ?? '',
    );

    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
        }),
        BullModule.forRootAsync({
          inject: [ConfigService],
          useFactory: (configService: ConfigService) => ({
            redis: {
              host: configService.get<string>('REDIS_HOST'),
              port: Number(configService.get<string>('REDIS_PORT')),
              password: configService.get<string>('REDIS_PASSWORD'),
              maxRetriesPerRequest: null,
              enableReadyCheck: false,
              retryStrategy: (times) => Math.min(times * 50, 2000),
            },
          }),
        }),
        HttpModule,
        AuthModule,
        DataRetentionModule,
        ScheduleModule.forRoot(),
        LoggerModule.forRootAsync({
          imports: [ConfigModule],
          inject: [ConfigService],
          useFactory: (config: ConfigService) => ({
            pinoHttp: {
              level: config.get('NODE_ENV') === 'production' ? 'info' : 'debug',
              serializers: {
                err: pino.stdSerializers.err,
                error: pino.stdSerializers.err,
              },
              autoLogging: {
                ignore: (req) => req.url === '/health',
              },
              transport:
                config.get('NODE_ENV') !== 'production'
                  ? {
                      target: 'pino-pretty',
                      options: {
                        colorize: true,
                        translateTime: 'SYS:standard',
                        ignore: 'pid,hostname',
                      },
                    }
                  : undefined,
            },
          }),
        }),
        HealthModule,
        FormsModule,
        DatabaseModule,
        ApplicationFormModule,
        AttachmentsModule,
        ApplicationPackageModule,
        HouseholdModule,
        ...(isDevelopment ? [DevToolsModule, BullDashboardModule] : []),
        SiebelModule,
        NotificationModule,
        EventEmitterModule.forRoot(),
      ],
    };
  }
}
