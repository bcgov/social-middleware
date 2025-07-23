import { applyDecorators } from '@nestjs/common';
import {
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiExcludeEndpoint,
} from '@nestjs/swagger';

export function DevOnlySwaggerDocs() {
  const isEnabled = process.env.ENABLE_DEV_TOOLS === 'true';

  // When dev tools are disabled, hide the endpoint from Swagger
  if (!isEnabled) {
    return applyDecorators(ApiExcludeEndpoint());
  }

  // When enabled, show full Swagger docs
  return applyDecorators(
    ApiOperation({ summary: '[DEV ONLY] Delete all user-related data' }),
    ApiQuery({ name: 'userId', required: true, type: String }),
    ApiResponse({ status: 200, description: 'User data deleted successfully' }),
  );
}
