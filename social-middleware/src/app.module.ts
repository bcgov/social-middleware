import { Module, DynamicModule } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { AuthModule } from './auth/auth.module';
import { LoggerModule } from 'nestjs-pino';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { HealthModule } from './health/health.module';
import { DatabaseModule } from './database/database.module';
import { FormsModule } from './forms/forms.module';
import { ApplicationModule } from './application/application.module';
import { DevToolsModule } from './dev-tools/dev-tools.module';
import { ContactModule } from './contact/contact.module';

@Module({})
export class AppModule {
  static register(): DynamicModule {
    const isDevelopment = process.env.NODE_ENV !== 'production';

    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
        }),
        HttpModule,
        AuthModule,
        LoggerModule.forRootAsync({
          imports: [ConfigModule],
          inject: [ConfigService],
          useFactory: (config: ConfigService) => ({
            pinoHttp: {
              level: config.get('NODE_ENV') === 'production' ? 'info' : 'debug',
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
        ContactModule,
        FormsModule,
        DatabaseModule,
        ApplicationModule,
        ...(isDevelopment ? [DevToolsModule] : []),
      ],
    };
  }
}
