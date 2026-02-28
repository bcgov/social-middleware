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
        const useTls = configService.get<string>('MONGO_USE_TLS', 'false') === 'true';
        const tlsCAFile = configService.get<string>('MONGO_TLS_CA_FILE');
        const replicaSet = configService.get<string>('MONGO_REPLICA_SET');

        if (!host || !port || !db) {
          throw new Error('Missing required MongoDB environment variables');
        }

        let uri = '';

        if (user && pass) {
          uri = `mongodb://${user}:${pass}@${host}:${port}/${db}?authSource=${db}`;
        } else {
          uri = `mongodb://${host}:${port}/${db}`;
        }

        // Add replica set parameter if configured
        if (replicaSet) {
          uri += uri.includes('?') ? '&' : '?';
          uri += `replicaSet=${replicaSet}`;
        }

        const connectionOptions: any = {
          uri,
        };

        // Add TLS configuration if enabled
        if (useTls) {
          connectionOptions.tls = true;

          if (tlsCAFile) {
            // Use CA file for certificate verification (production)
            connectionOptions.tlsCAFile = tlsCAFile;
            connectionOptions.tlsAllowInvalidCertificates = false;
          } else {
            // Allow connections without CA verification (development only)
            connectionOptions.tlsAllowInvalidCertificates = true;
            console.warn('MongoDB TLS enabled but no CA file provided - using tlsAllowInvalidCertificates');
          }
        }

        return connectionOptions;
      },
    }),
  ],
})
export class DatabaseModule {}
