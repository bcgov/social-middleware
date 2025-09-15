# social-middleware
A NestJS-based middleware service for social services applications, providing authentication, application management, and form handling capabilities.

## Overview

This middleware service acts as a bridge between frontend applications and backend services, handling:

- BC Services Card authentication
- Application creation and management
- Form parameter validation
- User management
- Health monitoring

## Features

- **BC Services Card Integration**: Secure authentication using BC Services Card OpenID Connect
- **Application Management**: Create and manage social service applications
- **Form Handling**: Token-based form access and parameter validation
- **User Management**: User creation, authentication, and session management
- **Health Monitoring**: Built-in health check endpoints
- **API Documentation**: Swagger/OpenAPI documentation
- **Logging**: Structured logging with Pino
- **Database Integration**: MongoDB with Mongoose ODM

## Tech Stack

- **Framework**: NestJS 11.x
- **Database**: MongoDB with Mongoose
- **Authentication**: JWT, BC Services Card OpenID Connect
- **Logging**: Pino with nestjs-pino
- **API Documentation**: Swagger/OpenAPI
- **Testing**: Jest
- **Validation**: class-validator, class-transformer

## Prerequisites

- Node.js (v18 or higher)
- MongoDB
- BC Services Card client credentials

## Environment Variables

Create a `.env` file in the root directory with the following variables:

```env
# Application
NODE_ENV=development
PORT=3001
APP_NAME=social-middleware

# Frontend
FRONTEND_URL=http://localhost:5173

# Database
MONGO_HOST=localhost
MONGO_PORT=27017
MONGO_DB=social_middleware
MONGO_USER=your_mongo_user
MONGO_PASS=your_mongo_password

# BC Services Card
BCSC_CLIENT_ID=your_bcsc_client_id
BCSC_CLIENT_SECRET=your_bcsc_client_secret
BCSC_AUTHORITY=https://your-bcsc-authority

# JWT
JWT_SECRET=your_jwt_secret_key

# Form Access Token
FORM_ACCESS_TOKEN_EXPIRY_MINUTES=30
```

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd social-middleware
```

2. Install dependencies:
```bash
npm install
```

3. Set up MongoDB (see MongoDB Setup section below)

4. Set up environment variables (see above)

5. Start the development server:
```bash
npm run start:dev
```

## MongoDB Setup

The middleware requires a MongoDB database to store user data, applications, and form parameters. Here are several options for setting up MongoDB:

### Option 1: Local MongoDB Installation

1. **Install MongoDB Community Edition**:
   - **macOS**: `brew tap mongodb/brew && brew install mongodb-community`
   - **Ubuntu/Debian**: Follow [MongoDB Ubuntu installation guide](https://docs.mongodb.com/manual/tutorial/install-mongodb-on-ubuntu/)
   - **Windows**: Download from [MongoDB Download Center](https://www.mongodb.com/try/download/community)

2. **Start MongoDB service**:
   ```bash
   # macOS/Linux
   sudo systemctl start mongod
   
   # macOS with Homebrew
   brew services start mongodb-community
   
   # Windows
   net start MongoDB
   ```

3. **Create database and user** (optional but recommended):
   ```bash
   # Connect to MongoDB shell
   mongosh
   
   # Create database
   use social_middleware
   
   # Create user with read/write permissions
   db.createUser({
     user: "middleware_user",
     pwd: "your_secure_password",
     roles: [
       { role: "readWrite", db: "social_middleware" }
     ]
   })
   ```

4. **Update environment variables**:
   ```env
   MONGO_HOST=localhost
   MONGO_PORT=27017
   MONGO_DB=social_middleware
   MONGO_USER=middleware_user
   MONGO_PASS=your_secure_password
   ```

### Database Collections

The middleware automatically creates the following collections:
- **users** - User profiles and authentication data
- **applications** - Social service applications
- **formparameters** - Form access tokens and configuration

### Database Indexes

The application creates these indexes automatically:
- `users.bc_services_card_id` (unique)
- `applications.applicationId` (unique)
- `formparameters.formAccessToken` (unique)

### Connection Troubleshooting

1. **Connection refused**: Ensure MongoDB is running and accessible
2. **Authentication failed**: Verify username/password in environment variables
3. **Database not found**: The database will be created automatically on first connection
4. **Network timeout**: Check firewall settings and network access (especially for Atlas)

### Development vs Production

**Development**:
- Local MongoDB or Docker container
- No authentication required (optional)
- Basic security settings

**Production**:
- MongoDB Atlas or properly secured self-hosted instance
- Authentication required
- SSL/TLS encryption
- Network access restrictions
- Regular backups

## API Endpoints

### Authentication (`/auth`)

- `POST /auth/callback` - BC Services Card authentication callback
- `GET /auth/status` - Get current authentication status
- `GET /auth/logout` - Logout and clear session

### Applications (`/application`)

- `POST /application` - Create a new application

### Forms (`/forms`)

- `POST /forms/validateTokenAndGetParameters` - Validate form access token and retrieve parameters

### Health (`/health`)

- `GET /health` - Health check endpoint

## API Documentation

When the server is running, visit `http://localhost:3001/api` to access the Swagger documentation.

## Development Scripts

```bash
# Development
npm run start:dev          # Start in watch mode
npm run start:debug        # Start in debug mode

# Building
npm run build              # Build the application
npm run start:prod         # Start production build

# Testing
npm run test               # Run unit tests
npm run test:watch         # Run tests in watch mode
npm run test:cov           # Run tests with coverage
npm run test:e2e           # Run end-to-end tests

# Code Quality
npm run lint               # Run ESLint
npm run format             # Format code with Prettier
```

## Project Structure

```
src/
├── application/           # Application management module
│   ├── dto/              # Data transfer objects
│   ├── enums/            # Application-related enums
│   ├── schemas/          # MongoDB schemas
│   └── application.service.ts
├── auth/                 # Authentication module
│   ├── dto/              # User DTOs
│   ├── enums/            # User status enums
│   ├── schemas/          # User schema
│   └── user.service.ts
├── database/             # Database configuration
├── forms/                # Form handling module
├── health/               # Health check module
└── main.ts               # Application entry point
```

## Authentication Flow

1. User initiates authentication through BC Services Card
2. BC Services Card redirects to `/auth/callback` with authorization code
3. Middleware exchanges code for tokens with BC Services Card
4. User information is retrieved and stored/updated in database
5. Session token (JWT) is created and stored in HTTP-only cookie
6. User can access protected endpoints with valid session

## Application Types

The system supports different application types:
- `Sample` - Default sample application
- `Foster Caregiver` - Foster caregiver applications

## Form Management

Forms are managed through access tokens that:
- Are generated when creating applications
- Have configurable expiry times (default: 30 minutes)
- Provide access to form parameters and configuration
- Support different form types: New, View, Edit

## Error Handling

The application includes comprehensive error handling:
- Validation errors for invalid input
- Authentication errors for unauthorized access
- Database errors with proper logging
- HTTP exceptions with appropriate status codes

## Logging

Structured logging is implemented using Pino:
- Development: Pretty-printed colored logs
- Production: JSON structured logs
- Configurable log levels
- Request/response logging

## Testing

The project includes:
- Unit tests for services and controllers
- Test configuration with Jest
- Coverage reporting
- E2E testing setup

Run tests:
```bash
npm run test              # Unit tests
npm run test:e2e          # End-to-end tests
npm run test:cov          # With coverage
```

## Security Considerations

- HTTP-only cookies for session management
- CORS configuration for frontend integration
- JWT token validation
- Secure cookie settings based on environment
- Input validation with class-validator
- Structured error responses without sensitive information

## Contributing

See [CONTRIBUTING](CONTRIBUTING.md)

## Code of Conduct

See [CODE OF CONDUCT](CODE_OF_CONDUCT.md)


## NOTE:

The [Digital Principles of BC Government](https://www2.gov.bc.ca/gov/content/governments/policies-for-government/core-policy/policies/im-it-management#12.1.1.5) encourage project teams to work in the open and this repo is public.

Take care to ensure no sensitive data is committed to the repository.
