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
      useFactory: async (configService: ConfigService) => {
        const user = configService.get<string>('MONGO_USER');
        const pass = configService.get<string>('MONGO_PASS');
        const host = configService.get<string>('MONGO_HOST', 'mongodb');
        const port = configService.get<string>('MONGO_PORT', '27017');
        const db = configService.get<string>('MONGO_DB');

        if (!user || !pass || !host || !db) {
          throw new Error('Missing required MongoDB environment variables');
        }

        const uri = `mongodb://${user}:${pass}@${host}:${port}/${db}?authSource=admin`;



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