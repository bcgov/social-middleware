import { Module, DynamicModule } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { AuthModule } from './auth/auth.module';
import { LoggerModule } from 'nestjs-pino';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { HealthModule } from './health/health.module';
import { DatabaseModule } from './database/database.module';
import { FormsModule } from './forms/forms.module';
//import { ApplicationModule } from './application/application.module';
import { ApplicationFormModule } from './application-form/application-form.module';
import { ApplicationPackageModule } from './application-package/application-package.module';
import { ApplicationSubmissionModule } from './application-submission/application-submission.module';
import { DevToolsModule } from './dev-tools/dev-tools.module';
import { ContactModule } from './contact/contact.module';
import { HouseholdModule } from './household/household.module';
import { BullDashboardModule } from './bull-dashboard/bull-dashboard.module';
import { SiebelModule } from './siebel/siebel.module';
import { ScheduleModule } from '@nestjs/schedule';

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
        ScheduleModule.forRoot(),
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
        //ApplicationModule,
        ApplicationSubmissionModule,
        ApplicationFormModule,
        ApplicationPackageModule,
        HouseholdModule,
        ...(isDevelopment ? [DevToolsModule] : []),
        BullDashboardModule,
        SiebelModule,
      ],
    };
  }
}
