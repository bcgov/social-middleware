import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const user = configService.get<string>('MONGO_USER');
        const pass = configService.get<string>('MONGO_PASS');
        const host = configService.get<string>('MONGO_HOST', 'mongodb');
        const port = configService.get<string>('MONGO_PORT', '27017');
        const db = configService.get<string>('MONGO_DB');

        if (!host || !port || !db) {
          throw new Error('Missing required MongoDB environment variables');
        }

        let uri = '';

        if (user && pass) {
          uri = `mongodb://${user}:${pass}@${host}:${port}/${db}`;
        } else {
          uri = `mongodb://${host}:${port}/${db}`;
        }

        return {
          uri,
          // useNewUrlParser: true,
          // useUnifiedTopology: true,
        };
      },
    }),
  ],
})
export class DatabaseModule {}
