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

        if (!host || !db) {
          throw new Error('Missing required MongoDB environment variables');
        }

        let uri = '';

        // If MONGO_HOST already contains ports (replica set), use it as-is
        // Otherwise, append MONGO_PORT
        const hostsWithPorts = host.includes(':') ? host : `${host}:${port}`;

        console.log('=== MongoDB Connection Debug ===');
        console.log('MONGO_USER:', user);
        console.log('MONGO_HOST:', host);
        console.log('MONGO_PORT:', port);
        console.log('MONGO_DB:', db);
        console.log('MONGO_REPLICA_SET:', replicaSet);
        console.log('MONGO_USE_TLS:', useTls);
        console.log('MONGO_TLS_CA_FILE:', tlsCAFile);
        console.log('hostsWithPorts:', hostsWithPorts);

        if (user && pass) {
          uri = `mongodb://${user}:${pass}@${hostsWithPorts}/${db}?authSource=${db}`;
        } else {
          uri = `mongodb://${hostsWithPorts}/${db}`;
        }

        // Add replica set parameter if configured
        if (replicaSet) {
          uri += uri.includes('?') ? '&' : '?';
          uri += `replicaSet=${replicaSet}`;
        }

        console.log('Final MongoDB URI (sanitized):', uri.replace(/:([^:@]+)@/, ':***@'));

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
            console.log('TLS Config: Using CA file at', tlsCAFile);
          } else {
            // Allow connections without CA verification (development only)
            connectionOptions.tlsAllowInvalidCertificates = true;
            console.warn('MongoDB TLS enabled but no CA file provided - using tlsAllowInvalidCertificates');
          }
        }

        console.log('Connection options (sanitized):', {
          ...connectionOptions,
          uri: connectionOptions.uri.replace(/:([^:@]+)@/, ':***@')
        });
        console.log('================================');
        console.log('Attempting to connect to MongoDB...');

        // Add connection timeout and retry settings
        connectionOptions.serverSelectionTimeoutMS = 10000; // 10 second timeout
        connectionOptions.connectTimeoutMS = 10000;
        connectionOptions.socketTimeoutMS = 45000;
        connectionOptions.maxPoolSize = 10;
        connectionOptions.minPoolSize = 1;

        console.log('Timeout settings:', {
          serverSelectionTimeoutMS: connectionOptions.serverSelectionTimeoutMS,
          connectTimeoutMS: connectionOptions.connectTimeoutMS,
          socketTimeoutMS: connectionOptions.socketTimeoutMS
        });

        return connectionOptions;
      },
      connectionFactory: (connection) => {
        console.log('🔧 MongoDB connectionFactory called - setting up event handlers');

        connection.on('connecting', () => {
          console.log('🔌 MongoDB: Connecting...');
        });

        connection.on('connected', () => {
          console.log('✅ MongoDB: Successfully connected!');
          console.log('MongoDB connection state:', connection.readyState);
        });

        connection.on('open', () => {
          console.log('📖 MongoDB: Connection opened');
        });

        connection.on('error', (error) => {
          console.error('❌ MongoDB connection error:');
          console.error('Error name:', error.name);
          console.error('Error message:', error.message);
          console.error('Full error:', JSON.stringify(error, null, 2));
        });

        connection.on('disconnecting', () => {
          console.warn('⏳ MongoDB: Disconnecting...');
        });

        connection.on('disconnected', () => {
          console.warn('⚠️  MongoDB: Disconnected');
        });

        connection.on('reconnected', () => {
          console.log('🔄 MongoDB: Reconnected');
        });

        connection.on('close', () => {
          console.warn('🚪 MongoDB: Connection closed');
        });

        // Log initial connection state
        console.log('Initial MongoDB connection state:', connection.readyState);
        console.log('0=disconnected, 1=connected, 2=connecting, 3=disconnecting');

        return connection;
      },
    }),
  ],
})
export class DatabaseModule {}
